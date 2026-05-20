// 引入所需的库和模块
const express = require('express');
const app = express();
const path = require('path');
const { Level } = require('level');
const fs = require("fs");
const pino = require('pino');
const Web3 = require('web3');
const mysql = require('mysql2'); // 使用mysql2模块
const crypto = require('./crypto/index');
const { ttpService } = require('./services/ttpService');
const session = require('express-session');

// 获取合约ABI和字节码
const VotingSystemContract = require('./build/contracts/VotingSystem.json');
const contractABI = VotingSystemContract.abi;
const contractBytecode = VotingSystemContract.bytecode;

// 打开或创建leveldb数据库
const db = new Level('ethereum', { valueEncoding: 'json' })
// 连接到以太坊网络
const web3 = new Web3('http://localhost:7545');

// 获取 Ganache 默认账户用于合约部署
let ganacheAccount = null;

// 使用 express.urlencoded() 中间件解析表单数据
app.use(express.urlencoded({ extended: true }));

// 使用 express.json() 中间件解析 JSON 数据
app.use(express.json());

// 会话管理
app.use(session({
    secret: 'blockvote-anon-cred-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24h
}));

// 认证路由
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// ─── 登录拦截中间件 ───
const publicPaths = ['/login.html', '/register.html'];
const publicExts = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2'];
app.use((req, res, next) => {
    // 放过静态资源扩展名
    if (publicExts.some(ext => req.path.endsWith(ext))) return next();
    // 放过公开路径
    if (publicPaths.some(p => req.path.startsWith(p))) return next();
    // 放过 /api/auth 路径（登录/注册接口）
    if (req.path.startsWith('/api/auth')) return next();
    // 放过 /api/votes 路径（公开投票列表）
    if (req.path.startsWith('/api/votes')) return next();
    // 放过 /api/ballot 路径（投票浏览器）
    if (req.path.startsWith('/api/ballot')) return next();
    // 未登录
    if (!req.session || !req.session.user) {
        // API 请求返回 JSON
        if (req.path.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(401).json({ success: false, message: '请先登录' });
        }
        // 页面请求重定向到登录
        return res.redirect('/login.html');
    }
    next();
});

// 设置静态文件目录（放在 auth 中间件之后，确保需要登录的页面被拦截）
app.use(express.static(path.join(__dirname, 'public')));

// 流日志
const stream = fs.createWriteStream("./log.txt", { flags: 'a' });
const logger = pino(stream);

// 创建MySQL连接池
const { db: dbConfig } = require('./config');
const pool = mysql.createPool(dbConfig);
  
// 存储区块信息到数据库
async function saveBlockData(blockData) {
    try {
        const blockDataString = JSON.stringify(blockData); 
        await db.put(blockData.blockHash, blockDataString); // 存储转换后的字符串到数据库
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        throw error; // 抛出异常以便调用者捕获并处理
    }
}

// 根据区块哈希检索区块信息
async function getBlockData(blockHash) {
    try {
        const data = await db.get(blockHash);
        const parsedData = JSON.parse(data); // 解析为 JSON 格式
        return parsedData; // 返回完整的区块数据对象
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        return null; // 或者返回空对象 {}
    }
}

// 将MySQL连接池添加到Express应用程序的本地变量中
app.locals.pool = pool;

// 插入数据到 ballots 表
function insertDataIntoBallots(creatorAddress, contractAddress, voteTitle, deadline) {
    // 构建插入语句
    const sql = `INSERT INTO ballots (creator_address, contract_address, vote_title, deadline) VALUES (?, ?, ?, ?)`;

    // 使用连接池执行插入操作
    pool.query(sql, [creatorAddress, contractAddress, voteTitle, deadline], (error, results, fields) => {
        if (error) {
            logger.error({
                errorMessage: error.message,
                stackTrace: error.stack
            });
            return;
        }
    });
}

// 插入id和hash值
function insertIntoEthereum(blockID, hashValue) {
    const sql = 'INSERT INTO blockdata (blockID, hashValue) VALUES (?, ?)';
    pool.query(sql, [blockID, hashValue], (error, result, fields) => {
        if (error) {
            logger.error({
                errorMessage: error.message,
                stackTrace: error.stack
            });
            return;
        }
    })
}

// 从数据库中获取 ballots 数据并返回给前端
function getBallotsData(callback) {
    // 构建查询语句
    const sql = `SELECT * FROM blockdata ORDER BY blockID DESC`;

    // 使用连接池获取连接
    pool.getConnection((error, connection) => {
        if (error) {
            logger.error({
                errorMessage: error.message,
                stackTrace: error.stack
            });
            callback(error, null);
            return;
        }

        // 执行查询操作
        connection.query(sql, (error, results, fields) => {
            // 释放连接
            connection.release();

            if (error) {
                logger.error({
                    errorMessage: error.message,
                    stackTrace: error.stack
                });
                callback(error, null);
                return;
            }

            // 查询成功，将结果返回给回调函数
            callback(null, results);
        });
    });
}

// 插入历史合约数据的函数
function insertHistoryContract(contractAddress, voterAddress, voteTitle, deadline, userChoice, voterEmail) {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                reject(err);
                return;
            }

            const query = 'INSERT INTO history_contracts (contract_address, voter_address, vote_title, deadline, user_choice, created_at, voter_email) VALUES (?, ?, ?, ?, ?, NOW(), ?)';
            connection.query(query, [contractAddress, voterAddress, voteTitle, deadline, userChoice, voterEmail || null], (error, results) => {
                connection.release();
                if (error) {
                    reject(error);
                    return;
                }
                resolve(results);
            });
        });
    });
}
  
// 在应用程序关闭时关闭数据库连接
process.on('SIGINT', () => {
  pool.end((err) => {
    if (err) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        process.exit(1);
    }
    console.log('程序关闭，成功关闭数据库连接');
    logger.info('program broken (CTRL + C)');
    process.exit(0);
  });
});

async function saveBlockDataToDatabase(fromAddress, toAddress) {
    try {
        // 在发生交易后调用该函数
        const block = await web3.eth.getBlock('latest');
        const blockData = {
            blockId: block.number,
            timestamp: block.timestamp,
            blockHash: block.hash,
            parentHash: block.parentHash,
            difficulty: block.difficulty,
            miner: block.miner,
            stateRoot: block.stateRoot,
            transactionsRoot: block.transactionsRoot,
            receiptsRoot: block.receiptsRoot,
            txHash: block.transactions,
            gasUsed: block.gasUsed,
            gasLimit: block.gasLimit,
            fromAddress: fromAddress, 
            toAddress: toAddress, 
            uncles: block.uncles
        };
        insertIntoEthereum(block.number, block.hash); 
        await saveBlockData(blockData); 
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
    }
}

// 创建 POST 路由处理前端提交的表单数据
app.post('/createVote', async (req, res) => {
    // 从请求体中提取表单数据
    const formData = req.body;
    // 使用 Ganache 账户部署合约（不再依赖客户端 MetaMask 签名）
    const deployer = ganacheAccount || '0x0000000000000000000000000000000000000001';
    // 用于数据库存储的创建者标识：优先使用前端传来的 creatorAddress
    const creatorAddress = formData.creatorAddress || deployer;
    // 单独保存表单数据的各个字段
    const voteTitle = formData.voteTitle;
    const numOptions = formData.numOptions;
    const options = [];
    for (let i = 1; i <= numOptions; i++) {
        options.push(formData['option' + i]);
    }

    // 获取截止时间的时间戳（毫秒）
    const deadlineTimestamp = new Date(formData.deadline).getTime();
    try {
        // 部署新的合约
        let newContractInstance = await new web3.eth.Contract(contractABI)
            .deploy({
                data: contractBytecode,
                arguments: [voteTitle, options, deadlineTimestamp]
            })
            .send({
                from: deployer,
                gas: 3000000,
                gasPrice: '30000000000'
            });

        // 存入日志文件中
        logger.info({
            message: "Successfully to create a new contract",
            contractAddress: newContractInstance.options.address,
            createdBy: creatorAddress,
            voteTitle,
            deadlineTimestamp,
            options
        });

        res.json({ success: true, contractAddress: newContractInstance.options.address });
        // 在成功部署合约后调用该函数，将合约信息插入到数据库中
        const deadlineForDb = new Date(formData.deadline).toISOString().slice(0, 19).replace('T', ' ');
        insertDataIntoBallots(creatorAddress, newContractInstance.options.address, voteTitle, deadlineForDb);
        initContract(voteTitle, options, deadlineTimestamp, deployer, newContractInstance);
        // 部署合约成功后获取区块和交易信息
        saveBlockDataToDatabase(deployer, newContractInstance.options.address);
    } catch (error) {
        // 记录出错时的日志信息
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ error: 'Failed to deploy contract: ' + error.message });
    }
});

// 使用合约实例调用Solidity合约中的函数
async function initContract(voteTitle, options, deadlineTimestamp, metaMaskUser, newContractInstance) {
    try {
        // 调用Solidity合约中的setTitle函数
        await newContractInstance.methods.setTitle(voteTitle).send({
            from: metaMaskUser, // 从这个地址发送交易
            gas: 3000000 // 设置gas限制
        });
        saveBlockDataToDatabase(metaMaskUser, newContractInstance.options.address);
        // 调用Solidity合约中的setOptions函数
        await newContractInstance.methods.setOptions(options).send({
            from: metaMaskUser, // 从这个地址发送交易
            gas: 3000000 // 设置gas限制
        });
        saveBlockDataToDatabase(metaMaskUser, newContractInstance.options.address);
        // 调用Solidity合约中的setDeadline函数
        await newContractInstance.methods.setDeadline(deadlineTimestamp).send({
            from: metaMaskUser, // 从这个地址发送交易
            gas: 3000000 // 设置gas限制
        });
        saveBlockDataToDatabase(metaMaskUser, newContractInstance.options.address);
        // 设置投票状态
        await newContractInstance.methods.setIsOpen(true).send({
            from: metaMaskUser, // 从这个地址发送交易
            gas: 3000000 // 设置gas限制
        });
        saveBlockDataToDatabase(metaMaskUser, newContractInstance.options.address);
    } catch (error) {
        // 记录错误日志
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
    }
}

app.get('/ethereum', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ethereum.html'));
});

// 查询整个网络上的区块
app.get('/allBlocks', async (req, res) => {
    try {
        // 从数据库获取 ballots 数据
        getBallotsData((error, results) => {
            if (error) {
                logger.error({
                    errorMessage: error.message,
                    stackTrace: error.stack
                });
                res.status(500).json({ success: false, error: 'Failed to retrieve data from MySQL' });
                return;
            }

            // 数据提取成功，将结果发送给客户端
            res.status(200).json({ success: true, data: results });
        });
    } catch (error) {
        // 如果发生错误，则向客户端发送错误响应
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ success: false, error: 'Failed to retrieve data from Leveldb' });
    }
});

app.get('/getBallotInfo', async (req, res) => {
    try {
        const contractAddress = req.query.contractAddress;
        // 创建合约实例
        const contractInstance = new web3.eth.Contract(contractABI, contractAddress);

        // 调用合约实例的方法获取投票项目信息
        const options = await contractInstance.methods.getOptions().call();
        const title = await contractInstance.methods.getBallotTitle().call();
        const deadlineTimestamp = await contractInstance.methods.getDeadline().call();

        // 将时间戳转换为格式化的日期
        const deadlineDate = new Date(Number(deadlineTimestamp));
        const formattedDeadline = deadlineDate.toLocaleString();

        // 返回获取到的投票项目信息，包括格式化后的截止日期
        res.json({ options, title, deadline: formattedDeadline });
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ error: 'Failed to get ballot info' });
    }
});

// 获取所有活跃投票合约（供匿名投票页面选择）
app.get('/api/votes/active', (req, res) => {
    const sql = `SELECT contract_address, vote_title, deadline, creator_address FROM ballots WHERE deleted = false ORDER BY deadline ASC`;
    pool.query(sql, (error, rows) => {
        if (error) {
            res.json({ success: false, votes: [] });
        } else {
            res.json({ success: true, votes: rows });
        }
    });
});

// 获取当前用户创建的智能合约
app.post('/getContracts', (req, res) => {
    const userPublicKey = req.body.publicKey;
    const sql = `SELECT * FROM ballots WHERE creator_address = ? AND deleted = false ORDER BY deadline DESC`;
    pool.query(sql, [userPublicKey], (error, results) => {
        if (error) {
            logger.error({
                errorMessage: error.message,
                stackTrace: error.stack
            });
            res.status(500).json({ error: 'Failed to fetch contracts' });
            return;
        }
        res.json({ contracts: results });
    });
});

// 查询某个区块的详细信息
app.post('/blockDetails', async (req, res) => {
    try {
        const { hash } = req.body; // 获取请求中的哈希值
        // 获取区块详细信息
        const blockData = await getBlockData(hash);
        // 将区块详细信息返回给前端
        res.status(200).json({ success: true, data: blockData });
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ success: false, error: 'Failed to fetch block details' });
    }
});

app.post('/deleteContract', (req, res) => {
    const contractAddress = req.body.contractAddress;
    const publicKey = req.body.publicKey;
    // 检查用户是否有权限删除合约，这里可以根据实际需求进行权限验证

    // 更新数据库中对应合约的 deleted 字段为真
    const queryString = 'UPDATE ballots SET deleted = true WHERE contract_address = ? AND creator_address = ?';
    pool.query(queryString, [contractAddress, publicKey], (err, result) => {
        if (err) {
            logger.error({
                errorMessage: error.message,
                stackTrace: error.stack
            });
            res.status(500).json({ success: false, message: '合约删除失败' });
            return;
        }
        res.json({ success: true, message: '合约删除成功' });
    });
});

// 获取当前用户参加过的投票项目
app.post('/getHistoryContracts', (req, res) => {
    const userPublicKey = req.body.publicKey;
    const sql = `SELECT * FROM history_contracts WHERE voter_address = ? ORDER BY deadline DESC`;
    pool.query(sql, [userPublicKey], (error, results) => {
        if (error) {
            logger.error({
                errorMessage: error.message,
                stackTrace: error.stack
            });
            res.status(500).json({ error: 'Failed to fetch contracts' });
            return;
        }
        res.json({ contracts: results });
    });
});

// 匿名匿名投票（使用凭证系统令牌 - 直接调用密码学验证）
app.post('/voteAnon', async (req, res) => {
    try {
        const contractAddress = req.body.contractAddress;
        const selectedOption = req.body.selectedOption;
        const tokHashRaw = req.body.tokHash;
        const tokData = req.body.tokData;

        // 将十进制 tokHash 转为 bytes32 十六进制格式（兼容旧格式）
        const tokHash = typeof tokHashRaw === 'string' && !tokHashRaw.startsWith('0x')
            ? '0x' + BigInt(tokHashRaw).toString(16).padStart(64, '0')
            : tokHashRaw;

        if (!contractAddress || !selectedOption || !tokHash || !tokData) {
            return res.status(400).json({ success: false, message: '缺少参数' });
        }

        // 1. 直接调用 Verify 验证令牌（不经过 HTTP，避免自引用）
        if (!ttpService.initialized || !ttpService.pk) {
            return res.json({ success: false, message: '凭证系统未初始化' });
        }

        const tok = {
            sigma1: crypto.G1.fromHex(tokData.sigma1),
            sigma2: crypto.G1.fromHex(tokData.sigma2),
            gPrime: crypto.G2.fromHex(tokData.gPrime),
            D: tokData.D,
            disclosedHashes: (tokData.disclosedHashes || tokData.D.map(() => '1')).map(h => crypto.Fr.create(BigInt(h))),
            pi2: { c: 1n, s: 1n },
        };

        const verifyResult = crypto.Verify(ttpService.pk, ttpService.pp, tok);
        if (!verifyResult || !verifyResult.valid) {
            return res.json({ success: false, message: '令牌验证失败（双线性配对不通过）' });
        }

        // 2. 检查合约状态
        const contractInstance = new web3.eth.Contract(contractABI, contractAddress);
        const isOpen = await contractInstance.methods.getIsOpen().call();
        if (!isOpen) { return res.json({ success: false, message: '投票已结束' }); }

        const tokenUsed = await contractInstance.methods.hasTokenUsed(tokHash).call();
        if (tokenUsed) { return res.json({ success: false, message: '该令牌已投过票，可能为重复投票' }); }

        const deadlineTimestamp = await contractInstance.methods.getDeadline().call();
        if (Math.floor(Date.now()) >= Number(deadlineTimestamp)) {
            return res.json({ success: false, message: '投票已经截止' });
        }

        // 3. 使用中继账户提交匿名投票交易
        const accounts = await web3.eth.getAccounts();
        const relayAccount = accounts[0];
        await contractInstance.methods.castVoteAnon(selectedOption, tokHash).send({
            from: relayAccount,
            gas: 3000000,
        });

        saveBlockDataToDatabase(relayAccount, contractInstance.options.address);

        // 4. 记录投票历史（绑定用户邮箱）
        const voteTitle = await contractInstance.methods.getBallotTitle().call();
        const deadlineData = new Date(Number(deadlineTimestamp));
        const anonAddr = '0xAnon_' + String(tokHash).substring(0, 34);
        const userEmail = req.session.user?.email || '';
        await insertHistoryContract(contractAddress, anonAddr, voteTitle, deadlineData, selectedOption, userEmail);

        logger.info({ message: '匿名投票成功', contractAddress, tokHash: String(tokHash).substring(0, 20) });
        res.json({ success: true, message: '匿名投票成功' });
    } catch (error) {
        logger.error({ errorMessage: error.message, stackTrace: error.stack });
        res.status(500).json({ success: false, error: '匿名投票失败: ' + error.message });
    }
});

// 进行投票
app.post('/vote', async (req, res) => {
    try {
        const contractAddress = req.query.contractAddress;
        const selectedOption = decodeURIComponent(req.query.selectedOption);
        const publicKey = req.query.publicKey;
        const contractInstance = new web3.eth.Contract(contractABI, contractAddress);
        // 调用合约实例的方法获取投票项目信息
        const deadlineTimestamp = await contractInstance.methods.getDeadline().call();
        const voteTitle = await contractInstance.methods.getBallotTitle().call();
        // 获取当前时间戳
        const currentTimestamp = Math.floor(Date.now());
        // 如果当前时间晚于投票截止日期，则投票已经截至
        if (currentTimestamp >= deadlineTimestamp) {
            res.json({ success: false, message: '投票已经截止' });
            return;
        }
        // 已经投过票
        const hasVoted = await contractInstance.methods.hasVotedForBallot(contractAddress).call();
        if(hasVoted) {
            res.json({ success: false, message: '您已经投过票了' });
            return;
        }
        // 调用合约的投票函数
        await contractInstance.methods.castVote(selectedOption).send({
            from: publicKey, // 从这个地址发送交易
            gas: 3000000 // 设置gas限制
        }); 
        saveBlockDataToDatabase(publicKey, contractInstance.options.address);
        const deadlineData = new Date(Number(deadlineTimestamp));
        const userEmail = req.session.user?.email || '';
        await insertHistoryContract(contractAddress, publicKey, voteTitle, deadlineData, selectedOption, userEmail);
        // 发送响应
        res.json({ success: true });
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ success: false, error: '投票失败' });
    }
});

// 搜索合约的路由处理程序
app.post('/searchContracts', async (req, res) => {
    try {
        const keyword = req.body.keyword;
        const userPublicKey = req.body.userPublicKey;

        // 构建 SQL 查询语句
        let query;
        let queryParams;
        if (/^0x[a-fA-F0-9]{40}$/.test(keyword)) {
            // 如果关键字是合约地址，则查询指定地址的合约信息
            query = 'SELECT * FROM ballots WHERE contract_address = ? AND creator_address = ?';
            queryParams = [keyword, userPublicKey];
        } else {
            // 如果关键字不是合约地址，则执行模糊查询
            query = 'SELECT * FROM ballots WHERE (contract_address LIKE ? OR vote_title LIKE ?) AND creator_address = ?';
            const searchTerm = '%' + keyword + '%';
            queryParams = [searchTerm, searchTerm, userPublicKey];
        }

        // 执行数据库查询
        pool.query(query, queryParams, (error, results, fields) => {
            if (error) {
                logger.error({
                    errorMessage: error.message,
                    stackTrace: error.stack
                });
                res.status(500).json({ message: '内部服务器错误' });
                return;
            }
            if (results.length === 0) {
                res.status(404).json({ message: '未找到匹配的合约或项目' });
                return;
            }
            // 返回查询结果
            res.json({ contracts: results });
        });
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ message: '内部服务器错误' });
    }
});

// 搜索历史合约的路由处理程序
app.post('/searchHistoryContracts', async (req, res) => {
    try {
        const keyword = req.body.keyword;
        const userPublicKey = req.body.userPublicKey;

        // 构建 SQL 查询语句
        let query;
        let queryParams;
        if (/^0x[a-fA-F0-9]{40}$/.test(keyword)) {
            // 如果关键字是合约地址，则查询指定地址的合约信息
            query = 'SELECT * FROM history_contracts WHERE contract_address = ? AND voter_address = ?';
            queryParams = [keyword, userPublicKey];
        } else {
            // 如果关键字不是合约地址，则执行模糊查询
            query = 'SELECT * FROM history_contracts WHERE (contract_address LIKE ? OR vote_title LIKE ?) AND voter_address = ?';
            const searchTerm = '%' + keyword + '%';
            queryParams = [searchTerm, searchTerm, userPublicKey];
        }

        // 执行数据库查询
        pool.query(query, queryParams, (error, results, fields) => {
            if (error) {
                logger.error({
                    errorMessage: error.message,
                    stackTrace: error.stack
                });
                res.status(500).json({ message: '内部服务器错误' });
                return;
            }
            if (results.length === 0) {
                res.status(404).json({ message: '未找到匹配的合约或项目' });
                return;
            }
            // 返回查询结果
            res.json({ contracts: results });
        });
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ message: '内部服务器错误' });
    }
});

// 路由处理函数，根据合约地址返回合约详情数据
app.post('/getContractDetails', async (req, res) => {
    try {
        const contractAddress = req.body.contractAddress; // 从请求体中获取合约地址
        // 创建合约实例
        const contractInstance = new web3.eth.Contract(contractABI, contractAddress);

        // 调用合约实例的方法获取投票项目信息
        const options = await contractInstance.methods.getOptions().call();
        const title = await contractInstance.methods.getBallotTitle().call();
        const deadlineTimestamp = await contractInstance.methods.getDeadline().call();
        const isOpen = await contractInstance.methods.getIsOpen().call();
        // 获取每个候选项的得票数
        const voteCounts = await contractInstance.methods.getVoteCounts().call();
        // 将时间戳转换为格式化的日期
        const deadlineDate = new Date(Number(deadlineTimestamp));
        const formattedDeadline = deadlineDate.toLocaleString();
        // 返回获取到的投票项目信息，包括格式化后的截止日期和每个候选项的得票数
        res.json({ options, title, deadline: formattedDeadline, voteCounts });
    } catch (error) {
        logger.error({
            errorMessage: error.message,
            stackTrace: error.stack
        });
        res.status(500).json({ error: 'Failed to get ballot info' });
    }
});

// ─── GET /api/ballot/:address/events ───
// 获取投票合约的链上事件（用于投票浏览器验证匿名性）
app.get('/api/ballot/:address/events', async (req, res) => {
    try {
        const { address } = req.params;
        const contractInstance = new web3.eth.Contract(contractABI, address);

        // 获取合约基本信息
        const options = await contractInstance.methods.getOptions().call();
        const title = await contractInstance.methods.getBallotTitle().call();
        const deadlineTimestamp = await contractInstance.methods.getDeadline().call();
        const isOpen = await contractInstance.methods.getIsOpen().call();
        const voteCounts = await contractInstance.methods.getVoteCounts().call();

        // 获取创建事件
        const createdEvents = await contractInstance.getPastEvents('BallotCreated', {
            fromBlock: 0,
            toBlock: 'latest'
        });

        // 获取投票事件
        const voteEvents = await contractInstance.getPastEvents('VoteCasted', {
            fromBlock: 0,
            toBlock: 'latest'
        });

        // 格式化投票事件
        const formattedVotes = voteEvents.map((e, i) => ({
            index: i + 1,
            voter: e.returnValues.voter,
            isAnonymous: e.returnValues.voter === '0x0000000000000000000000000000000000000000',
            transactionHash: e.transactionHash,
            blockNumber: e.blockNumber,
        }));

        // 统计匿名/非匿名投票数
        const anonCount = formattedVotes.filter(v => v.isAnonymous).length;
        const directCount = formattedVotes.filter(v => !v.isAnonymous).length;

        // 将投票计数转为数字数组
        const counts = voteCounts.map(c => Number(c));

        res.json({
            success: true,
            contract: {
                address,
                title,
                options,
                deadline: Number(deadlineTimestamp),
                deadlineFormatted: new Date(Number(deadlineTimestamp)).toLocaleString(),
                isOpen,
                voteCounts: counts,
                totalVotes: counts.reduce((a, b) => a + b, 0),
            },
            events: {
                created: createdEvents.map(e => ({
                    creator: e.returnValues.creator,
                    transactionHash: e.transactionHash,
                    blockNumber: e.blockNumber,
                })),
                votes: formattedVotes,
                anonymousCount: anonCount,
                directCount: directCount,
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: '获取合约数据失败: ' + error.message
        });
    }
});

// 引入匿名凭证系统路由
const credentialRoutes = require('./routes/credentialRoutes');
app.use('/api/credential', credentialRoutes);

// 启动服务器
const PORT = process.env.PORT || 3000;

async function startServer() {
    // 确保 Ganache 账户已就绪
    try {
        const accounts = await web3.eth.getAccounts();
        if (accounts && accounts.length > 0) {
            ganacheAccount = accounts[0];
            console.log('Ganache 账户已就绪:', ganacheAccount);
        }
    } catch (e) {
        console.error('获取 Ganache 账户失败:', e.message);
        console.log('使用默认地址部署合约（可能失败）');
    }

    app.listen(PORT, () => {
        logger.info('begin working!');
        logger.info({
            message: `Server is running on port ${PORT}`,
        });
        console.log(`Server is running on port ${PORT}`);
    });
}

startServer();
