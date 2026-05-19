# BlockVote — 基于区块链的可撤销匿名投票系统

> 🧋 **如果你觉得作者的东西不错，可以请我喝杯奶茶！**  
> 扫码支持：
>
> <div style="display: flex; gap: 8px; flex-wrap: nowrap; overflow-x: auto;">
> <img src="wechat.jpg" width="256" />
> <img src="Alipay.jpg" width="256" />
> </div>

---

## 📖 项目简介

BlockVote 是一个**基于区块链的可撤销匿名投票系统**，结合了智能合约、密码学零知识证明和传统 Web 技术，实现安全、公正、隐私保护的投票流程。

### 核心特性

- **🔗 区块链存证**：投票记录上链，不可篡改，可追溯
- **🔐 可撤销匿名凭证**：基于双线性配对的阈值匿名凭证系统，支持用户匿名投票，同时可在违规时由可信第三方追踪身份
- **🎭 两种投票模式**：支持普通实名投票和匿名凭证投票
- **📊 可视化统计**：投票结果自动渲染为柱状图
- **🛡️ 三重存储架构**：智能合约 + 后端服务 + 数据库（MySQL + LevelDB）

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端页面层 (public/)                   │
│  登录/注册 | 创建投票 | 参与投票 | 我的投票 | 历史合约 | 区块浏览器 │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│                    后端服务层 (app.js)                    │
│  Express + Session | MySQL连接池 | LevelDB | Web3.js     │
│  路由: authRoutes | credentialRoutes                     │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  智能合约层   │  │  密码学服务层  │  │   数据存储层      │
│ VotingSystem │  │  TTP/Issuer  │  │ MySQL + LevelDB  │
│ CredentialMg │  │  Tracer      │  │ ethereum/ (Level)│
└──────────────┘  └──────────────┘  └──────────────────┘
```

### 智能合约

| 合约 | 说明 |
|------|------|
| `VotingSystem.sol` | 投票核心合约，支持创建投票、投票、统计结果、匿名投票（基于令牌） |
| `CredentialManager.sol` | 可撤销匿名凭证管理合约，存储注册、凭证、令牌、撤销信息 |

### 密码学模块 (`crypto/`)

基于双线性配对的阈值匿名凭证系统，包含以下核心算法：

| 模块 | 功能 |
|------|------|
| `setup.js` | 系统初始化，生成公共参数 |
| `keygen.js` | TTP密钥生成、追踪者密钥生成 |
| `ukeygen.js` | 用户密钥生成 |
| `obtain.js` | 用户获取凭证 |
| `issue.js` | 发行者颁发凭证 |
| `credagg.js` | 凭证聚合 |
| `show.js` | 凭证展示（生成匿名令牌） |
| `verify.js` | 凭证验证 |
| `trace.js` | 追踪违规用户 |
| `revoke.js` | 撤销凭证 |

### 服务层 (`services/`)

| 服务 | 功能 |
|------|------|
| `ttpService.js` | 可信第三方服务：系统初始化、密钥分发 |
| `issuerService.js` | 发行者服务：验证注册、颁发凭证 |
| `tracerService.js` | 追踪者服务：追踪身份、执行撤销 |

---

## 📋 环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Node.js | v20.x | 推荐 v20.11.0+ |
| npm | v10.x | 推荐 v10.2.4+ |
| Truffle | v5.11.5+ | 智能合约编译部署工具 |
| Ganache | v2.7.1+ | 本地以太坊测试网络 |
| MetaMask | v11.10.0+ | 浏览器钱包插件 |
| MySQL | v8.0+ | 关系型数据库 |
| Solidity | v0.8.0 | 智能合约语言 |

---

## 🚀 快速开始

### 第一步：安装依赖

```bash
# 进入项目目录
cd blockvote

# 安装 Node.js 依赖
npm install
```

### 第二步：配置 MySQL 数据库

1. 启动 MySQL 服务
2. 创建数据库：

```sql
CREATE DATABASE blockvote;
```

3. 导入数据库结构（`db/blockvote.sql`）：

```bash
mysql -u root -p blockvote < db/blockvote.sql
```

或手动执行以下 SQL 创建表：

```sql
-- 投票项目表
CREATE TABLE ballots (
    id INT NOT NULL AUTO_INCREMENT,
    creator_address VARCHAR(42) NOT NULL,
    contract_address VARCHAR(42) NOT NULL,
    vote_title VARCHAR(255) NOT NULL,
    deadline TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id)
);

-- 投票历史记录表
CREATE TABLE history_contracts (
    id INT NOT NULL AUTO_INCREMENT,
    contract_address VARCHAR(255) NOT NULL,
    voter_address VARCHAR(255) NOT NULL,
    vote_title VARCHAR(255) NOT NULL,
    deadline TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    user_choice VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    voter_email VARCHAR(255),
    PRIMARY KEY (id)
);

-- 区块数据表
CREATE TABLE blockdata (
    id BIGINT NOT NULL AUTO_INCREMENT,
    blockID BIGINT NOT NULL,
    hashValue VARCHAR(66) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE INDEX uniq_blockID (blockID),
    UNIQUE INDEX uniq_hashValue (hashValue)
);

-- 用户认证表
CREATE TABLE credential_users (
    id INT NOT NULL AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    user_id VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255),
    PRIMARY KEY (id)
);
```

4. 修改数据库连接配置（`app.js` 第 79-84 行）：

```javascript
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',          // 你的 MySQL 用户名
    password: '123456',    // 你的 MySQL 密码
    database: 'blockvote'
});
```

### 第三步：配置 MetaMask

1. 在 Chrome 浏览器安装 [MetaMask 插件](https://metamask.io/)
2. 创建账户并保存助记词
3. 添加 Ganache 本地网络：

   - 打开 Ganache，点击 **QUICK START** → **ETHEREUM**
   - 在 MetaMask 中点击网络下拉 → **添加网络** → **手动添加网络**
   - 填写以下信息：
     | 字段 | 值 |
     |------|-----|
     | 网络名称 | `Ganache Local` |
     | 新的 RPC URL | 从 Ganache 界面复制（如 `http://127.0.0.1:7545`） |
     | 链 ID | Ganache 显示的 Chain ID（默认 `1337`） |
     | 货币符号 | `ETH` |
     | 区块浏览器 URL | （可选）留空 |

4. 从 Ganache 导入测试账户：
   - 在 Ganache 界面查看 **ACCOUNTS** 标签
   - 复制任意账户的 **Private Key**
   - 在 MetaMask 中：账户菜单 → **导入账户** → 粘贴私钥

5. 测试转账确保网络正常

### 第四步：编译并部署智能合约

```bash
# 编译合约
truffle compile

# 部署合约到 Ganache
truffle migrate
```

部署后合约地址会记录在 `build/contracts/` 中，后端会自动读取。

> ⚠️ **注意**：Truffle 配置在 `truffle-config.js` 中，默认连接 `127.0.0.1:7545`。如需修改，请编辑该文件。

### 第五步：启动项目

```bash
# 确保 Ganache 正在运行
# 启动后端服务器
node app.js
```

服务器默认运行在 `http://localhost:3000`（或 `app.js` 中配置的端口）。

### 第六步：访问系统

在浏览器打开 `http://localhost:3000`，即可使用以下功能：

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页 | `/index.html` | 系统介绍 |
| 登录 | `/login.html` | 用户登录 |
| 注册 | `/register.html` | 用户注册 |
| 仪表盘 | `/dashboard.html` | 用户主页 |
| 创建投票 | `/create-vote.html` | 创建新的投票项目 |
| 参与投票 | `/join-vote.html` | 普通方式参与投票 |
| 匿名凭证投票 | `/vote-with-credential.html` | 使用匿名凭证投票 |
| 我的投票 | `/my-votes.html` | 查看和管理已创建的投票 |
| 历史合约 | `/history-contracts.html` | 查看参与过的投票历史 |
| 区块浏览器 | `/vote-explorer.html` | 查看链上区块数据 |
| 凭证系统 | `/credential-system.html` | 匿名凭证系统管理界面 |
| 管理员 | `/admin.html` | 管理员功能 |

---

## 📁 项目结构

```
blockvote/
├── app.js                  # 主应用入口（Express + Web3 + MySQL + LevelDB）
├── package.json            # 项目依赖配置
├── truffle-config.js       # Truffle 合约编译部署配置
├── public/                 # 前端静态页面
│   ├── index.html          # 首页
│   ├── login.html          # 登录页
│   ├── register.html       # 注册页
│   ├── dashboard.html      # 仪表盘
│   ├── create-vote.html    # 创建投票
│   ├── join-vote.html      # 参与投票
│   ├── vote-with-credential.html  # 匿名凭证投票
│   ├── my-votes.html       # 我的投票
│   ├── history-contracts.html     # 历史合约
│   ├── vote-explorer.html  # 区块浏览器
│   ├── credential-system.html     # 凭证系统
│   └── admin.html          # 管理员
├── routes/                 # 后端路由
│   ├── authRoutes.js       # 认证路由（登录/注册/退出）
│   └── credentialRoutes.js # 凭证系统路由
├── services/               # 业务服务
│   ├── ttpService.js       # 可信第三方服务
│   ├── issuerService.js    # 发行者服务
│   └── tracerService.js    # 追踪者服务
├── crypto/                 # 密码学模块（双线性配对匿名凭证）
│   ├── index.js            # 模块入口
│   ├── curve.js            # 椭圆曲线运算
│   ├── setup.js            # 系统初始化
│   ├── keygen.js           # TTP/追踪者密钥生成
│   ├── ukeygen.js          # 用户密钥生成
│   ├── obtain.js           # 凭证获取
│   ├── issue.js            # 凭证颁发
│   ├── credagg.js          # 凭证聚合
│   ├── show.js             # 凭证展示
│   ├── verify.js           # 凭证验证
│   ├── trace.js            # 身份追踪
│   └── revoke.js           # 撤销管理
├── contracts/              # 智能合约
│   ├── VotingSystem.sol    # 投票系统合约
│   └── CredentialManager.sol  # 凭证管理合约
├── migrations/             # 合约部署迁移脚本
│   └── 2_deploy_contracts.js
├── build/                  # 编译后的合约（编译后生成）
├── ethereum/               # LevelDB 数据存储目录
├── db/                     # 数据库脚本
│   └── blockvote.sql       # MySQL 数据库结构
├── test/                   # 测试文件
└── log.txt                 # 应用日志
```

---

## 🔧 配置说明

### 数据库配置

修改 `app.js` 中的 MySQL 连接配置：

```javascript
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '你的密码',
    database: 'blockvote'
});
```

### 会话配置

修改 `app.js` 中的 session 配置（第 34-39 行）：

```javascript
app.use(session({
    secret: '你的自定义密钥',  // 修改为安全的随机字符串
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }  // Cookie 有效期（毫秒）
}));
```

### 合约部署配置

编辑 `truffle-config.js`：

```javascript
module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",   // Ganache 地址
      port: 7545,           // Ganache 端口
      network_id: "*"       // 匹配任意网络 ID
    }
  },
  compilers: {
    solc: {
      version: "0.8.0",     // Solidity 编译器版本
    }
  }
};
```

---

## 📚 功能说明

### 1. 用户认证

- 使用用户名/密码注册和登录
- 密码使用 PBKDF2-SHA512 加盐哈希存储
- Session 会话管理，24 小时有效期
- 未登录用户自动重定向到登录页

### 2. 创建投票

- 输入投票主题
- 输入 2-10 个候选项
- 设置截止日期
- 投票信息同时存储到智能合约和 MySQL 数据库

### 3. 参与投票

- **普通投票**：直接通过 MetaMask 签名投票
- **匿名凭证投票**：使用可撤销匿名凭证系统，保护投票者隐私

### 4. 匿名凭证系统

基于论文《可撤销匿名凭证机制设计》实现的双线性配对阈值匿名凭证：

- **TTP（可信第三方）**：系统初始化、生成主密钥、分发发行者和追踪者密钥
- **发行者（Issuer）**：验证用户注册信息后颁发属性凭证
- **追踪者（Tracer）**：在需要时（如违规）可追踪用户真实身份
- **阈值安全**：需要多个发行者/追踪者协作才能完成密钥生成和追踪

### 5. 投票统计

- 投票结束后自动计算结果
- 柱状图可视化展示各选项得票数
- 支持按合约地址和投票主题查询

### 6. 区块浏览器

- 查看所有链上区块数据
- 区块哈希、区块 ID 等信息存储于 LevelDB 和 MySQL

---

## ⚠️ 注意事项

1. **Ganache 必须保持运行**：整个投票过程中 Ganache 不能关闭，否则合约状态会丢失
2. **MetaMask 网络切换**：操作前确保 MetaMask 已切换到 Ganache 网络
3. **数据库密码**：生产环境请修改 `app.js` 中的默认数据库密码
4. **Session 密钥**：生产环境请修改默认的 session secret
5. **合约部署**：每次修改合约后需要重新 `truffle compile` 和 `truffle migrate`

---

## 📄 许可证

ISC License

---

## 🙏 致谢

- [Truffle Suite](https://trufflesuite.com/) — 智能合约开发框架
- [Web3.js](https://web3js.readthedocs.io/) — Ethereum JavaScript API
- [Express.js](https://expressjs.com/) — Web 应用框架
- [atpdxy/blockvote: 基于区块链的投票系统](https://github.com/atpdxy/blockvote)
- R. Shi et al., "Threshold Attribute-Based Credentials With Redactable Signature," in IEEE Transactions on Services Computing, vol. 16, no. 5, pp. 3751-3765, Sept.-Oct. 2023, doi: 10.1109/TSC.2023.3280914.
