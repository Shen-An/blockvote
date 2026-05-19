const express = require('express');
const router = express.Router();
const crypto = require('../crypto/index');
const { ttpService } = require('../services/ttpService');
const { IssuerService } = require('../services/issuerService');
const { TracerService } = require('../services/tracerService');
const mysql = require('mysql2');

const issuerService = new IssuerService(ttpService);
const tracerService = new TracerService(ttpService);

const promisePool = mysql.createPool({
    host: 'localhost', user: 'root', password: '123456', database: 'blockvote',
    waitForConnections: true, connectionLimit: 10
}).promise();

// 使用 session 中的 userId（数据库主键），前端 body 中的 userId 仅作凭证身份标识
function getUserId(req) {
    return (req.session && req.session.user && req.session.user.userId) || req.body.userId || null;
}

// 获取凭证身份标识（优先使用邮箱作为密码学身份，回退到 body userId）
function getCredentialId(req) {
    return req.body.credentialId || (req.session && req.session.user && req.session.user.email) || req.body.userId || null;
}

// ─── POST /api/credential/setup ───
router.post('/setup', (req, res) => {
    try {
        const { lambda, n_I, t_I, n_T, t_T, q } = req.body;
        const result = ttpService.initialize(lambda || 128, n_I || 5, t_I || 3, n_T || 3, t_T || 2, q || 3);
        res.json({ success: true, result });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── GET /api/credential/status ───
router.get('/status', async (req, res) => {
    let hasCredential = false;
    let credentialRevoked = false;
    let tokenCount = 0;
    try {
        const userId = getUserId(req);
        if (userId) {
            const [rows] = await promisePool.execute(
                'SELECT status FROM user_credentials WHERE user_id = ? AND cred_type = ?',
                [userId, 'credential']
            );
            hasCredential = rows.some(r => r.status === 'active');
            credentialRevoked = rows.some(r => r.status === 'revoked');
            const [trows] = await promisePool.execute(
                'SELECT COUNT(*) as cnt FROM credential_tokens WHERE user_id = ?', [userId]
            );
            tokenCount = trows[0].cnt;
        }
    } catch (e) { /* 未登录或查询失败，使用默认值 */ }

    // 如果系统未初始化，DB 中的数据已过期（服务器重启后 TTP 状态丢失），不显示为已获取
    if (!ttpService.initialized) {
        hasCredential = false;
        credentialRevoked = false;
    }

    res.json({
        initialized: ttpService.initialized,
        issuerCount: ttpService.issuers?.length || 0,
        tracerCount: ttpService.tracers?.length || 0,
        n_I: ttpService.pp?.n_I || 0,
        t_I: ttpService.pp?.t_I || 0,
        n_T: ttpService.pp?.n_T || 0,
        t_T: ttpService.pp?.t_T || 0,
        q: ttpService.pp?.q || 0,
        hasCredential,
        credentialRevoked,
        credentialStatus: credentialRevoked ? 'revoked' : (hasCredential ? 'active' : 'none'),
        tokenCount,
    });
});

// ─── POST /api/credential/keygen ───
router.post('/keygen', async (req, res) => {
    try {
        const userId = getUserId(req);
        const credId = getCredentialId(req);
        if (!userId) return res.status(400).json({ success: false, message: '请先登录' });
        if (!ttpService.pp) return res.status(400).json({ success: false, message: '系统未初始化' });

        const user = crypto.UKeyGen(credId || userId, ttpService.pp);

        // 存入数据库
        const upkHex = user.upk.toHex();
        const uskStr = user.usk.toString();
        await promisePool.execute(
            'UPDATE credential_users SET upk = ?, usk = ? WHERE user_id = ?',
            [upkHex, uskStr, userId]
        );

        res.json({ success: true, upk: upkHex });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── POST /api/credential/register ───
router.post('/register', async (req, res) => {
    try {
        const userId = getUserId(req);
        const credId = getCredentialId(req);
        const { attributes } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: '请先登录' });
        if (!attributes) return res.status(400).json({ success: false, message: 'attributes required' });
        if (!ttpService.pp) return res.status(400).json({ success: false, message: '系统未初始化' });

        // 为本次会话生成新鲜密钥（使用邮箱作为凭证身份标识）
        const userKey = crypto.UKeyGen(credId || userId, ttpService.pp);
        const upkHex = userKey.upk.toHex();
        const uskStr = userKey.usk.toString();
        await promisePool.execute(
            'UPDATE credential_users SET upk = ?, usk = ? WHERE user_id = ?',
            [upkHex, uskStr, userId]
        );
        const reg = crypto.Obtain(
            credId || userId, userKey.usk, userKey.upk, userKey.h,
            attributes, ttpService.issuers, ttpService.tracers, ttpService.pp
        );
        const regHash = typeof reg.regHash === 'bigint' ? reg.regHash.toString() : reg.regHash;

        // 持久化到 DB（序列化关键字段为 JSON）
        const regData = JSON.stringify({
            regHash,
            encryptedAttrs: reg.encryptedAttrs.length,
            attrHashes: reg.attrHashes.map(h => h.toString()),
        });
        const attrs = JSON.stringify(attributes);
        await promisePool.execute(
            'INSERT INTO user_credentials (user_id, cred_type, attributes) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE attributes = VALUES(attributes)',
            [userId, 'registration', attrs]
        );

        tracerService.registerUser(reg);

        res.json({ success: true, regHash, encryptedAttrs: reg.encryptedAttrs.length });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── POST /api/credential/issue ───
router.post('/issue', async (req, res) => {
    try {
        const userId = getUserId(req);
        const credId = getCredentialId(req);
        const { issuerIndices } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: '请先登录' });
        if (!issuerIndices) return res.status(400).json({ success: false, message: 'issuerIndices required' });

        // 从 DB 读取属性重建 reg
        const [rows] = await promisePool.execute(
            'SELECT attributes FROM user_credentials WHERE user_id = ? AND cred_type = ?', [userId, 'registration']
        );
        if (rows.length === 0) return res.status(400).json({ success: false, message: '请先注册 (/register)' });

        const attributes = JSON.parse(rows[0].attributes);
        const h = crypto.H2(credId || userId);

        const [urows] = await promisePool.execute('SELECT upk, usk FROM credential_users WHERE user_id = ?', [userId]);
        if (!urows[0] || !urows[0].usk) return res.status(400).json({ success: false, message: '请先生成密钥 (/keygen)' });
        const usk = crypto.Fr.create(BigInt(urows[0].usk));
        const upk = crypto.G1.fromHex(urows[0].upk);
        const reg = crypto.Obtain(credId || userId, usk, upk, h, attributes, ttpService.issuers, ttpService.tracers, ttpService.pp);

        const creds = [];
        for (const idx of issuerIndices) {
            const cred_i = issuerService.issueCredential(userId, reg, idx);
            if (cred_i) creds.push(cred_i);
        }

        // 持久化：更新签发状态
        await promisePool.execute(
            'UPDATE user_credentials SET status = ? WHERE user_id = ? AND cred_type = ?',
            ['issued', userId, 'registration']
        );

        res.json({ success: true, issuedCount: creds.length });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── POST /api/credential/aggregate ───
router.post('/aggregate', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(400).json({ success: false, message: '请先登录' });

        // 检查注册状态
        const [rows] = await promisePool.execute(
            'SELECT status FROM user_credentials WHERE user_id = ? AND cred_type = ?', [userId, 'registration']
        );
        if (rows.length === 0 || rows[0].status !== 'issued') {
            return res.status(400).json({ success: false, message: '请先完成签发 (/issue)' });
        }

        // 检查是否已被撤销
        const [credRows] = await promisePool.execute(
            'SELECT status FROM user_credentials WHERE user_id = ? AND cred_type = ?', [userId, 'credential']
        );
        if (credRows.some(r => r.status === 'revoked')) {
            return res.status(400).json({ success: false, message: '凭证已被撤销，无法重新激活' });
        }

        // 标记凭证完成
        await promisePool.execute(
            'INSERT INTO user_credentials (user_id, cred_type, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
            [userId, 'credential', 'active']
        );

        // 标记 session/localStorage 用
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── POST /api/credential/show ───
router.post('/show', async (req, res) => {
    try {
        const userId = getUserId(req);
        const credId = getCredentialId(req);
        const { discloseIndices } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: '请先登录' });

        const [rows] = await promisePool.execute(
            'SELECT status FROM user_credentials WHERE user_id = ? AND cred_type = ?', [userId, 'credential']
        );
        if (rows.length === 0 || rows[0].status !== 'active') {
            if (rows.some(r => r.status === 'revoked')) {
                return res.status(400).json({ success: false, message: '凭证已被撤销，无法生成令牌' });
            }
            return res.status(400).json({ success: false, message: '请先获取凭证' });
        }

        // 二次检查：TTP 内存撤销列表
        if (ttpService.initialized && credId) {
            const revoked = tracerService.getRevokedUsers();
            if (revoked.includes(credId)) {
                return res.status(400).json({ success: false, message: '凭证已被撤销，无法生成令牌' });
            }
        }

        // 生成令牌（使用邮箱作为凭证身份标识）
        const [urows] = await promisePool.execute('SELECT upk FROM credential_users WHERE user_id = ?', [userId]);
        const h = crypto.H2(credId || userId);
        const upk = crypto.G1.fromHex(urows[0].upk);

        const r = crypto.randomScalar();
        const tok = {
            sigma1: h.multiply(r).toHex(),
            sigma2: h.multiply(crypto.Fr.mul(r, crypto.randomScalar())).toHex(),
            gPrime: crypto.G2.BASE.multiply(crypto.randomScalar()).toHex(),
            D: discloseIndices || [1],
        };
        const tokHashFull = crypto.H_c('tok', tok.sigma1, tok.sigma2);
        const tokHashBigInt = BigInt(tokHashFull.toString());
        const tokHash = '0x' + tokHashBigInt.toString(16).padStart(64, '0');

        // 存储令牌到 DB
        await promisePool.execute(
            'INSERT INTO credential_tokens (user_id, tok_hash, tok_data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tok_data = VALUES(tok_data)',
            [userId, tokHash, JSON.stringify(tok)]
        );

        res.json({
            success: true,
            tokHash,
            token: tok,
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── POST /api/credential/verify ───
router.post('/verify', (req, res) => {
    try {
        const { tokData } = req.body;
        if (!tokData) return res.status(400).json({ success: false, message: 'tokData required' });
        if (!ttpService.pk) return res.status(400).json({ success: false, message: '系统未初始化' });

        const tok = {
            sigma1: crypto.G1.fromHex(tokData.sigma1),
            sigma2: crypto.G1.fromHex(tokData.sigma2),
            gPrime: crypto.G2.fromHex(tokData.gPrime),
            D: tokData.D,
            disclosedHashes: (tokData.disclosedHashes || tokData.D.map(() => crypto.Fr.ONE)).map(h => crypto.Fr.create(BigInt(h))),
            pi2: tokData.pi2 || { c: 1n, s: 1n },
        };

        const result = crypto.Verify(ttpService.pk, ttpService.pp, tok);
        res.json({ success: result.valid, valid: result.valid });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── POST /api/credential/trace ───
router.post('/trace', async (req, res) => {
    try {
        const { tokHash, tracerIndices } = req.body;
        if (!tokHash || !tracerIndices) {
            return res.status(400).json({ success: false, message: 'tokHash and tracerIndices required' });
        }
        if (tracerIndices.length < (ttpService.pp?.t_T || 2)) {
            return res.status(400).json({ success: false, message: `至少需要 ${ttpService.pp?.t_T || 2} 个追踪者` });
        }

        // 数据库查找 tokHash 对应的用户
        let userId = null;
        try {
            const [rows] = await promisePool.execute(
                'SELECT user_id FROM credential_tokens WHERE tok_hash = ?', [tokHash]
            );
            if (rows.length > 0) {
                userId = rows[0].user_id;
            }
        } catch (e) { /* 表不存在或查询失败 */ }

        // 备用：通过 tracerService 的注册表查找
        if (!userId) {
            userId = tracerService.traceUser(null, tracerIndices);
        }

        res.json({ success: !!userId, userId });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── POST /api/credential/revoke ───
router.post('/revoke', async (req, res) => {
    try {
        // 使用用户输入的 ID（邮箱），因为注册时的 reg.id 是邮箱
        const credId = req.body.userId || getCredentialId(req);
        const { tracerIndices } = req.body;
        if (!credId) return res.status(400).json({ success: false, message: 'credentialId required' });
        if (!tracerIndices) return res.status(400).json({ success: false, message: 'tracerIndices required' });

        const rev = tracerService.revokeUser(credId, tracerIndices);
        if (!rev) return res.status(400).json({ success: false, message: `撤销失败：注册表中未找到用户 "${credId}"，请先完成注册步骤` });

        // 同步更新数据库中的凭证状态为 revoked
        try {
            const dbUserId = getUserId(req);
            if (dbUserId) {
                await promisePool.execute(
                    'UPDATE user_credentials SET status = ? WHERE user_id = ? AND cred_type = ?',
                    ['revoked', dbUserId, 'credential']
                );
            }
        } catch (e) { /* DB 更新失败不影响撤销结果 */ }

        res.json({ success: !!rev, userId: credId });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─── GET /api/credential/revoked ───
router.get('/revoked', (req, res) => {
    res.json({ revoked: tracerService.getRevokedUsers() });
});

// ─── POST /api/credential/userStatus ───
router.post('/userStatus', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.json({ loggedIn: false });

        const [rows] = await promisePool.execute(
            'SELECT status, attributes FROM user_credentials WHERE user_id = ? ORDER BY cred_type', [userId]
        );
        const [trows] = await promisePool.execute(
            'SELECT COUNT(*) as cnt FROM credential_tokens WHERE user_id = ?', [userId]
        );

        const hasCred = rows.some(r => r.cred_type === 'credential' && r.status === 'active');
        const isRevoked = rows.some(r => r.cred_type === 'credential' && r.status === 'revoked');
        const hasReg = rows.some(r => r.cred_type === 'registration' && r.status === 'issued');

        res.json({
            loggedIn: true,
            hasRegistration: hasReg,
            hasCredential: hasCred,
            credentialRevoked: isRevoked,
            tokenCount: trows[0].cnt,
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;