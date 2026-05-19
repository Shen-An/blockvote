const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost', user: 'root', password: '123456', database: 'blockvote',
    waitForConnections: true, connectionLimit: 10
});

const promisePool = pool.promise();

// 密码哈希
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return salt + ':' + hash;
}

function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const calc = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === calc;
}

// 注册
router.post('/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: '用户名和密码必填' });
        if (username.length < 2) return res.json({ success: false, message: '用户名至少2个字符' });
        if (password.length < 4) return res.json({ success: false, message: '密码至少4个字符' });
        if (!email) return res.json({ success: false, message: '邮箱必填' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ success: false, message: '邮箱格式不正确' });

        // 检查重复
        const [exist] = await promisePool.execute('SELECT id FROM credential_users WHERE username = ?', [username]);
        if (exist.length > 0) return res.json({ success: false, message: '用户名已存在' });

        const [emailExist] = await promisePool.execute('SELECT id FROM credential_users WHERE email = ?', [email]);
        if (emailExist.length > 0) return res.json({ success: false, message: '邮箱已被注册' });

        const userId = 'user_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
        const pwdHash = hashPassword(password);

        await promisePool.execute(
            'INSERT INTO credential_users (username, password_hash, user_id, email) VALUES (?, ?, ?, ?)',
            [username, pwdHash, userId, email]
        );

        req.session.user = { username, userId, email };
        req.session.save();

        res.json({ success: true, username, userId, email });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 登录
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: '用户名和密码必填' });

        const [rows] = await promisePool.execute(
            'SELECT * FROM credential_users WHERE username = ?', [username]
        );
        if (rows.length === 0) return res.json({ success: false, message: '用户名或密码错误' });

        if (!verifyPassword(password, rows[0].password_hash)) {
            return res.json({ success: false, message: '用户名或密码错误' });
        }

        req.session.user = { username: rows[0].username, userId: rows[0].user_id, email: rows[0].email || '' };
        req.session.save();

        res.json({ success: true, username: rows[0].username, userId: rows[0].user_id, email: rows[0].email || '' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 退出
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// 获取当前用户
router.get('/me', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

module.exports = router;