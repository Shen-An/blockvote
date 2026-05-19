# 可撤销匿名凭证机制设计文档

## 基于双线性配对的阈值匿名凭证系统

---

## 1. 系统架构总览

### 1.1 参与实体

| 实体 | 符号 | 数量 | 角色 |
|------|------|------|------|
| 可信第三方 | TTP | 1 | 系统初始化、生成主密钥、分发密钥 |
| 发行者集合 | {I_i} | n_I (阈 t_I) | 为用户颁发属性凭证 |
| 追踪者集合 | {T_i} | n_T (阈 t_T) | 追踪违规用户身份、执行撤销 |
| 用户 | U | ∞ | 注册、获取凭证、匿名投票 |
| 验证者 | V | ∞ | 验证匿名投票有效性 |

### 1.2 三层存储架构

```
┌─────────────────────────────────────────────────────┐
│                    智能合约层                          │
│    CredentialManager.sol (注册/凭证/令牌/撤销链上存证)   │
│    VotingSystem.sol (投票逻辑，保持不变)               │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│                    后端服务层                          │
│    TTP 服务 (Setup, TTPKeyGen, TraceKeyGen)           │
│    发行者服务 (Issue - 验证注册, 盲签名)                │
│    追踪者服务 (Trace, Revoke - 阈值解密)                │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│                    数据库层                            │
│    MySQL (ballots, history_contracts - 保持原样)       │
│    LevelDB (注册信息密文, 凭证, 撤销列表)              │
└─────────────────────────────────────────────────────┘
```

---

## 2. 系统初始化流程 (Setup → TTPKeyGen → TraceKeyGen)

### 2.1 Setup(1^λ, n_I, t_I, n_T, t_T, q) → pp

```
算法: Setup

输入: 安全参数 λ, 发行者总数 n_I, 发行阈值 t_I, 追踪者总数 n_T,
      追踪阈值 t_T, 属性数量 q
输出: 公共参数 pp

步骤:
  1. 选择 λ 比特安全素数 p，构造 Type-III 双线性配对群:
     G1 × G2 → GT, 其中 |G1| = |G2| = |GT| = p
  2. 选择生成元: g ←R G1, g̃ ←R G2
  3. 选择随机元素: (h_1, h_2, ..., h_{q+1}) ←R G1
     (注: h_{q+1} 用于绑定用户私钥 usk)
  4. 选择哈希函数: H1: {0,1}* → Z_p, H2: {0,1}* → G1
  5. 输出公共参数:
     pp = (G1, G2, GT, g, g̃, p, e, n_I, t_I, n_T, t_T, q,
           h_1, ..., h_{q+1}, H1, H2)
```

### 2.2 TTPKeyGen(pp) → (msk, pk, {isk_i, ipk_i})

```
算法: TTPKeyGen

输入: 公共参数 pp
输出: 主私钥 msk, 验证公钥 pk, 发行者密钥对 {isk_i, ipk_i}

步骤:
  1. 选择主私钥: (x, y) ←R Z_p^2
  2. 计算验证公钥:
     X̃ = g̃^x
     FOR i = 1 TO q+1:          // n = q+1
         Y_i = g^{y^i}          // G1 元素
         Ỹ_i = g̃^{y^i}         // G2 元素
     FOR i = q+2 TO 2(q+1):
         Y_i = g^{y^i}          // G1 元素
     pk = (X̃, {Y_i, Ỹ_i}^{q+1}_{i=1}, {Y_i}^{2(q+1)}_{i=q+2})

  3. 为每个发行者 I_i 生成密钥:
     // 定义 2(q+2) 个 t_I-1 次多项式
     FOR k = 1 TO 2(q+2):
         a_{k,0} ←R Z_p           // 多项式常数项
         FOR j = 1 TO t_I-1:
             a_{k,j} ←R Z_p       // 多项式系数

     // 每个发行者 I_i 获得私钥:
     isk_i = { f_k(i) }^{2(q+2)}_{k=1}
      其中 f_k(i) = Σ^{t_I-1}_{j=0} a_{k,j} · i^j

     // 每个发行者 I_i 的公钥:
     ipk_i = { g^{f_k(i)} }^{2(q+2)}_{k=1}

  4. msk = (x, y)
  5. 安全存储 msk，公开 pk, {ipk_i}

  6. 部署 CredentialManager 智能合约:
     // 触发合约的 AddIssuer 和 AddTracer
     FOR each I_i:
         CredentialManager.AddIssuer(I_i, ipk_i)
     FOR each T_i:
         CredentialManager.AddTracer(T_i, tpk_i)
```

### 2.3 TraceKeyGen(pp) → {tsk_i, tpk_i}

```
算法: TraceKeyGen

输入: 公共参数 pp
输出: n_T 个追踪者密钥对 {(tsk_1, tpk_1), ..., (tsk_{n_T}, tpk_{n_T})}

步骤:
  FOR i = 1 TO n_T:
      tsk_i ←R Z_p                // 追踪私钥
      tpk_i = g̃^{tsk_i}          // 追踪公钥, 存入合约
  // tpk_i 上传至 CredentialManager.AddTracer(I_i, tpk_i)
```

---

## 3. 用户注册与凭证获取流程 (UKeyGen → Obtain/Issue → CredAgg)

### 3.1 UKeyGen(id, pp) → (usk, upk)

```
算法: UKeyGen

输入: 用户身份 id (如 DID 或邮箱哈希), 公共参数 pp
输出: 用户私钥 usk, 用户公钥 upk

步骤:
  1. usk ←R Z_p                    // 随机选择用户私钥
  2. h = H2(id)                    // 身份映射到 G1
  3. upk = h^{usk}                 // 用户公钥
  4. 用户安全存储 (id, usk, upk)
```

### 3.2 Obtain ↔ Issue: 获取部分凭证

```
// ───────────── 用户端 Obtain ─────────────

算法: Obtain(id, usk, upk, {m_j}^q_{j=1}, ipk_i, {tpk_j}^{n_T}_{j=1}, pp)

输入: 用户身份 id, 用户密钥 (usk, upk), q 个属性 {m_j},
      发行者公钥 ipk_i, 追踪者公钥集合 {tpk_j}, 公共参数 pp
输出: 注册信息 reg, 部分凭证 cred_i

步骤:
  1. // 生成 ElGamal 密钥对 (用于加密属性)
     z ←R Z_p
     Z = g^z                       // ElGamal 公钥

  2. // 加密每个属性 m_j
     FOR j = 1 TO q:
         r_j ←R Z_p
         α_j = g^{r_j}             // 密文第一部分
         β_j = h_{j+1}^{m_j} · Z^{r_j}  // 密文第二部分
         // 注: h_1 用于签名, h_2,...,h_{q+1} 对应 q 个属性
         // 属性 m_j ∈ {0,1}* (或有限域)

  3. // 使用 Shamir 秘密共享拆分 usk
     // 目标: n_T 个追踪者, 阈值 t_T
     选择 t_T-1 次多项式:
         P(s) = usk + a_1·s + a_2·s^2 + ... + a_{t_T-1}·s^{t_T-1}
     其中 a_1,...,a_{t_T-1} ←R Z_p

     计算份额:
         FOR i = 1 TO n_T:
             s_i = P(i)            // 第 i 个追踪者的份额

     用每个追踪者的公钥加密份额:
         FOR i = 1 TO n_T:
             r'_i ←R Z_p
             C̃_{1,i} = g^{r'_i}
             C̃_{2,i} = tpk_i^{r'_i} · Ỹ_{q+1}^{s_i}
             // 注: Ỹ_{q+1} = g̃^{y^{q+1}} 来自 pk

  4. // Feldman 可验证秘密共享承诺
     FOR j = 1 TO t_T-1:
         D_j = g^{a_j}             // 公开承诺

  5. // 构造知识证明 Π1 (非交互式 Fiat-Shamir)
     证明知道:
     - usk 和 z (秘密值)
     - 所有随机数 {r_j}^{q}_{j=1}, {r'_i}^{n_T}_{i=1}
     - 属性值 {m_j}^{q}_{j=1}
     - Shamir 份额 {s_i}^{n_T}_{i=1}
     满足:
     - upk = h^{usk} (h = H2(id))
     - Z = g^z
     - α_j = g^{r_j}, β_j = h_{j+1}^{m_j} · Z^{r_j}
     - C̃_{1,i} = g^{r'_i}, C̃_{2,i} = tpk_i^{r'_i} · Ỹ_{q+1}^{s_i}
     - g^{s_i} = g^{usk} · Π^{t_T-1}_{j=1} D_j^{i^j}
     - s_i = P(i) 是正确 Shamir 份额

     // 计算非交互式证明 (Sigma 协议 + Fiat-Shamir)
     // 为简洁省略 Sigma 协议展开细节, 使用标准技术
     Π1 = NIZK{(usk, z, {m_j,r_j}, {s_i,r'_i}):
                upk = h^{usk} ∧ ... ∧ g^{s_i} = g^{usk}ΠD_j^{i^j}}

  6. // 构建注册消息
     reg = (upk, Z, {α_j, β_j}^q_{j=1},
            {C̃_{1,i}, C̃_{2,i}}^{n_T}_{i=1},
            {D_j}^{t_T-1}_{j=1}, Π1)

  7. // 上传 reg 到智能合约
     CredentialManager.uploadReg(id, reg)

  8. // 发送 reg 给发行者 I_i, 获取部分凭证
     发送 reg 到发行者 I_i

// ───────────── 发行者端 Issue ─────────────

算法: Issue(isk_i, ipk_i, pp, reg)

输入: 发行者私钥 isk_i, 发行者公钥 ipk_i, 公共参数 pp, 注册信息 reg
输出: 盲签名 (α'_i, β'_i) (即部分凭证 cred_i)

步骤:
  1. // 验证知识证明 Π1
     验证 Π1 中所有关系
     IF 验证失败: RETURN ⊥

  2. // 验证 id 唯一性 (从合约检查)
     IF CredentialManager.getReg(id) ≠ ∅:
         RETURN ⊥ (id 已注册)

  3. // 验证属性合法性
     FOR j = 1 TO q:
         验证 m_j 在有效范围内 (如 {0,1} 或有效分类)
         (注: 发行者可自行定义属性验证规则)

  4. // 对用户公钥和密文进行盲签名 (CL 签名变体)
     // 使用发行者私钥 isk_i 生成部分凭证
     r'' ←R Z_p

     // 盲化: 在 ElGamal 密文上应用随机数
     α'_i = (Π^q_{j=1} α_j) · g^{r''}
           = g^{Σr_j + r''}
     β'_i = (Π^q_{j=1} β_j) · (X̃ · Π^q_{j=1} Ỹ_j)^{r''}
           = h_1 · Π^q_{j=1} h_{j+1}^{m_j} · Z^{Σr_j}
             · X̃^{r''} · Π^q_{j=1} Ỹ_j^{r''}

     注: 实际签名基于 isk_i, 使用函数 f_k(i):
     σ_i = (h_1 · Π^q_{j=1} h_{j+1}^{m_j} · h_{q+2}^{usk})^{f_1(i)/(f_2(i)+f_2(i)·?...)}

     为简化描述, 使用标准的 BBS+ 签名变体:
     σ_i = (h_1 · Π^q_{j=1} h_{j+1}^{m_j} · h_{q+2}^{usk})^{1/(x + Σ y^j + y^{q+1})} evaluated as isk_i

     cred_i = (α'_i, β'_i, σ_i)

  5. // 发行者将部分凭证写入合约
     CredentialManager.uploadCred(id, i, cred_i)
     RETURN cred_i
```

### 3.3 CredAgg: 聚合部分凭证

```
算法: CredAgg({cred_i}_{i∈I}, pp)

输入: t_I 个部分凭证 (来自集合 I, |I| ≥ t_I), 公共参数 pp
输出: 完整凭证 cred

步骤:
  1. // 从合约获取已上传的部分凭证
     FOR each i ∈ I:
         cred_i = CredentialManager.getCred(id, i)

  2. // 计算拉格朗日系数
     FOR each i ∈ I:
         λ_i = Π_{j∈I, j≠i} (0 - j) / (i - j) mod p

  3. // 聚合签名
     σ = Π_{i∈I} σ_i^{λ_i}
     // 根据 Shamir 秘密共享的性质:
     // σ = (h_1 · Π^q_{j=1} h_{j+1}^{m_j} · h_{q+2}^{usk})^{1/(x + y·Σy^j)}  ← 完整签名

  4. // 使用 ElGamal 同态性解盲
     用户计算 z (ElGamal 私钥):
     cred = (h, σ)
     其中 h = H2(id)

  5. // 验证凭证有效性
     IF e(σ, g̃) = e(h, X̃ · Π^q_{j=1} Ỹ_j^{m_j} · Ỹ_{q+1}^{usk}):
         cred 有效
     ELSE:
         RETURN ⊥

  6. 用户存储 cred = (h, σ)
```

---

## 4. 匿名投票流程 (Show/Verify)

### 4.1 Show: 生成匿名投票令牌

```
算法: Show(usk, {m_j}^q_{j=1}, D, cred, pp)

输入: 用户私钥 usk, q 个属性 {m_j}, 披露属性索引集合 D,
      完整凭证 cred = (h, σ), 公共参数 pp
输出: 匿名投票令牌 tok

步骤:
  1. // 使用 URS (Universal Reference String) 派生算法
     // URS = {Y_i}^{2(q+1)}_{i=1} (来自 pk)

  2. // 选择随机盲化因子
     r, t ←R Z_p^*

  3. // 盲化凭证 σ
     σ = (σ_1, σ_2)  // BBS+ 签名结构: σ_1 ∈ G1, σ_2 ∈ G1
     注: 实际 BBS+ 签名为 (σ_1, σ_2, σ_3), 此处对齐论文描述

     σ'_1 = σ_1^{r}
     σ'_2 = σ_2^{r} · (σ'_1)^{t}

  4. // 派生新的验证公钥
     // D: 不披露的属性集合 (隐藏的属性), |D| = k
     令 n = q + 1 (总属性数, 含 usk)
     令 D̄ = [1, n] \ D (披露的属性索引)

     g̃' = g̃^{t} · Π_{i∈D̄} Ỹ_i^{m_i}
     // 注: 此处 Ỹ_i 对应第 i 个属性, 使用 y^i 的幂次

  5. // 计算 URS 验证值
     FOR each i ∈ D:
         c_i = H(σ'_1, σ'_2, g̃', D, i)  // 随机预言机哈希

     // 计算 σ'_3 作为 URS 验证的关键部分
     σ'_3 = Π_{i∈D} [ Y_{n+1-i}^{t}
                      · Π_{j∈D̄} Y_{n+1-i+j}^{m_j}
                     ]^{c_i}
     // 注: 使用 pk 中的高阶 Y_i 值 (i > n+1)

  6. // 构造知识证明 Π2: 证明知道 usk
     // 证明内容:
     // "我知道 usk, 使得:
     //  e(σ'_1, X̃ · g̃' · Π_{i∈D} Ỹ_i^{m_i}) = e(σ'_2, g̃)
     //  且 h = H2(id) 且 upk = h^{usk}"

     // 使用 Sigma 协议:
     选择 r_usk ←R Z_p
     T_1 = h^{r_usk}
     c = H(σ'_1, σ'_2, σ'_3, g̃', T_1, D, {m_i}_{i∈D})
     s_usk = r_usk + c·usk (mod p)
     Π2 = (c, s_usk, T_1)

  7. // 构建匿名投票令牌
     tok = (σ'_1, σ'_2, σ'_3, g̃', {m_i}_{i∈D}, Π2)

  8. // 上传令牌到合约
     // 注意: 令牌与具体投票绑定
     txHash = CredentialManager.uploadToken(voteId, tok)
```

### 4.2 Verify: 验证匿名投票

```
算法: Verify(pk, pp, tok, L)

输入: 验证公钥 pk, 公共参数 pp, 匿名令牌 tok, 撤销列表 L
输出: (0/1, tok)  — 有效返回 1 且接受令牌, 否则返回 0

步骤:
  1. // 解析令牌
     (σ'_1, σ'_2, σ'_3, g̃', {m_i}_{i∈D}, Π2) = tok

  2. // 第一步: 验证签名核心等式
     // e(σ'_1, X̃ · g̃' · Π_{i∈D} Ỹ_i^{m_i}) ?= e(σ'_2, g̃)
     left_1 = e(σ'_1, X̃ · g̃' · Π_{i∈D} Ỹ_i^{m_i})
     right_1 = e(σ'_2, g̃)
     IF left_1 ≠ right_1: RETURN 0

  3. // 第二步: 验证 URS 派生
     // 重新计算 c_i
     FOR each i ∈ D:
         c_i = H(σ'_1, σ'_2, g̃', D, i)

     // e(Π_{i∈D} Y_{n+1-i}^{c_i}, g̃') ?= e(σ'_3, g̃)
     left_2 = e(Π_{i∈D} Y_{n+1-i}^{c_i}, g̃')
     right_2 = e(σ'_3, g̃)
     IF left_2 ≠ right_2: RETURN 0

  4. // 第三步: 撤销检查
     // 检查 tok 是否在撤销列表中
     IF CredentialManager.getRev(tok) ≠ ∅:
         RETURN 0 (已撤销)

  5. // 第四步: 验证知识证明 Π2
     解析 Π2 = (c, s_usk, T_1)
     T'_1 = h^{s_usk} · (upk)^{-c}
     c' = H(σ'_1, σ'_2, σ'_3, g̃', T'_1, D, {m_i}_{i∈D})
     IF c ≠ c': RETURN 0

  6. // 所有验证通过
     RETURN 1
```

### 4.3 匿名投票完整集成流程

```
// ───────────── 后端集成 ─────────────

// 修改 /vote 端点:
POST /vote:
  请求: { contractAddress, selectedOption, tok }

  1. 解析 tok = (σ'_1, σ'_2, σ'_3, g̃', {m_i}_{i∈D}, Π2)
  2. 调用 Verify(pk, pp, tok, L):
     IF 验证失败: RETURN { success: false, message: "凭证无效" }
  3. 检查撤销列表:
     IF tok 已被撤销: RETURN { success: false, message: "凭证已撤销" }
  4. 检查该投票的唯一性:
     IF tok 已用于此 voteId: RETURN { success: false, message: "重复投票" }
  5. 提交投票到智能合约:
     修改合约 castVote 接受 tok 而非直接地址
     或: 在链下验证后, 使用 keepers 提交投票
  6. 存储 tok 到 MySQL (去重):
     INSERT INTO vote_tokens (vote_id, tok_hash, selected_option)
  7. RETURN { success: true }
```

---

## 5. 违规追踪与撤销流程 (Trace → Revoke)

### 5.1 Trace: 追踪违规用户

```
// 触发条件: 发现重复投票 (同一 tok_hash 或同一凭证的多次使用)

算法: Trace({tsk_i}_{i∈T}, tok, L)

输入: t_T 个追踪者私钥 {tsk_i}, 违规令牌 tok, 账本 L
输出: 用户身份 id 或 ⊥

步骤:
  1. // 解析令牌中的披露属性
     {m_i}_{i∈D} = tok.m_i

  2. // 遍历注册账本 L (从合约获取所有注册信息)
     FOR each (id, reg) in CredentialManager.getAllRegs():
         // reg = (upk, Z, {α_j, β_j}, {C̃_{1,i}, C̃_{2,i}}, {D_j}, Π1)

         // 每个追踪者 T_i 解密注册中的份额
         FOR each j ∈ T (至少 t_T 个追踪者):
             R_{id,j} = C̃_{2,j} · C̃_{1,j}^{-tsk_j}
                      = (tpk_j^{r'_j} · Ỹ_{q+1}^{s_j}) · (g^{r'_j})^{-tsk_j}
                      = (g̃^{tsk_j · r'_j} · Ỹ_{q+1}^{s_j}) · g̃^{-tsk_j · r'_j}
                      = Ỹ_{q+1}^{s_j}

         // 使用拉格朗日插值恢复 Ỹ_{q+1}^{usk}
         λ_j = Π_{l∈T, l≠j} (0 - l) / (j - l) mod p
         R = Π_{j∈T} R_{id,j}^{λ_j} = Ỹ_{q+1}^{usk}

         // 注意: 由于 upk = h^{usk} 且 h = H2(id),
         // 可以通过检查 e(h, R) 验证匹配
         // 但更直接: 从令牌恢复 usk 的承诺

         // 实际检查: 从 tok 中提取信息匹配
         // 验证 e(σ'_1 · ... ) 等式是否与当前 id 相关

         // 简化: 比较 R 与 tok 中隐含的 usk
         IF 匹配:
             RETURN id

  3. // 若遍历完未找到
     RETURN ⊥
```

### 5.2 Revoke: 撤销违规凭证

```
算法: Revoke({tsk_i}_{i∈T}, id, pp)

输入: t_T 个追踪者私钥 {tsk_i}, 用户身份 id, 公共参数 pp
输出: 撤销信息 rev

步骤:
  1. // 从合约获取指定 id 的注册信息
     reg = CredentialManager.getReg(id)

  2. // 至少 t_T 个追踪者合作解密
     FOR each j ∈ T:
         R_{id,j} = C̃_{2,j} · C̃_{1,j}^{-tsk_j} = Ỹ_{q+1}^{s_j}

  3. // 拉格朗日插值恢复撤销信息
     λ_j = Π_{l∈T, l≠j} (0 - l) / (j - l) mod p
     rev = Π_{j∈T} R_{id,j}^{λ_j} = Ỹ_{q+1}^{usk}

  4. // 将撤销信息上传到合约
     CredentialManager.uploadRev(id, rev)

  5. // 合约将 rev 加入撤销列表
     // 后续验证时, 可检查:
     // e(h, rev) = e(upk, Ỹ_{q+1})?
     // 将 rev 与所有待验证令牌关联

  6. // 标记该用户的所有凭证为已撤销
     RETURN rev
```

---

## 6. 智能合约接口设计

### 6.1 CredentialManager.sol

```
// 对应论文 Fig.14 的智能合约接口

contract CredentialManager {
    // ─── 系统状态 ───
    struct IssuerInfo {
        bytes ipk;          // 发行者公钥
        bool isActive;
    }

    struct TracerInfo {
        bytes tpk;          // 追踪者公钥
        bool isActive;
    }

    struct Registration {
        bytes regData;      // (upk, Z, {α_j,β_j}, {C̃_{1,i},C̃_{2,i}}, {D_j}, Π1)
        bool exists;
    }

    struct Credential {
        bytes credData;     // 部分凭证数据
        bool uploaded;
    }

    struct Token {
        bytes tokData;      // (σ'_1, σ'_2, σ'_3, g̃', {m_i}_{i∈D}, Π2)
        bytes voteId;       // 关联的投票 ID
        bool used;
    }

    struct Revocation {
        bytes revData;      // 撤销信息 = Ỹ_{q+1}^{usk}
        bool revoked;
    }

    // ─── 存储 ───
    address public ttp;
    mapping(uint256 => IssuerInfo) public issuers;       // issuerId => Info
    mapping(uint256 => TracerInfo) public tracers;       // tracerId => Info
    mapping(bytes => Registration) public registrations; // userId => Registration
    mapping(bytes => mapping(uint256 => Credential)) public credentials; // userId => issuerId => Credential
    mapping(bytes => Token) public tokens;               // tokHash => Token
    mapping(bytes => bytes) public tValues;              // 临时计算值
    mapping(bytes => bytes) public iDValues;             // 临时计算值
    mapping(bytes => bytes) public qValues;              // 临时计算值
    mapping(bytes => Revocation) public revocations;     // userId => Revocation

    uint256 public issuerCount;
    uint256 public tracerCount;

    // ─── 事件 ───
    event IssuerAdded(uint256 indexed issuerId, bytes ipk);
    event TracerAdded(uint256 indexed tracerId, bytes tpk);
    event RegUploaded(bytes indexed userId);
    event CredUploaded(bytes indexed userId, uint256 issuerId);
    event TokenUploaded(bytes indexed tokHash, bytes voteId);
    event RevUploaded(bytes indexed userId);

    modifier onlyTTP() { require(msg.sender == ttp); _; }

    constructor() {
        ttp = msg.sender;
    }

    // ─── 接口函数 ───

    // Create: 初始化系统
    function Create(bytes calldata pp) external onlyTTP {
        // 存储公共参数
        // 初始化系统状态
    }

    // AddIssuer: 添加发行者
    function AddIssuer(uint256 issuerId, bytes calldata ipk) external onlyTTP {
        issuers[issuerId] = IssuerInfo(ipk, true);
        issuerCount++;
        emit IssuerAdded(issuerId, ipk);
    }

    // AddTracer: 添加追踪者
    function AddTracer(uint256 tracerId, bytes calldata tpk) external onlyTTP {
        tracers[tracerId] = TracerInfo(tpk, true);
        tracerCount++;
        emit TracerAdded(tracerId, tpk);
    }

    // uploadReg: 用户上传注册信息
    function uploadReg(bytes calldata userId, bytes calldata regData) external {
        require(!registrations[userId].exists, "已注册");
        registrations[userId] = Registration(regData, true);
        emit RegUploaded(userId);
    }

    // getReg: 获取注册信息 (用于追踪)
    function getReg(bytes calldata userId) external view returns (bytes memory) {
        require(registrations[userId].exists, "未注册");
        return registrations[userId].regData;
    }

    // getAllRegs: 获取所有注册信息 (追踪使用)
    function getAllRegs() external view returns (bytes[] memory, bytes[] memory) {
        // 返回所有 userId 和 regData 对
        // 实现视具体存储结构而定
    }

    // uploadCred: 发行者上传部分凭证
    function uploadCred(bytes calldata userId, uint256 issuerId, bytes calldata credData) external {
        require(issuers[issuerId].isActive, "发行者无效");
        require(registrations[userId].exists, "用户未注册");
        credentials[userId][issuerId] = Credential(credData, true);
        emit CredUploaded(userId, issuerId);
    }

    // getCred: 用户获取部分凭证
    function getCred(bytes calldata userId, uint256 issuerId) external view returns (bytes memory) {
        require(credentials[userId][issuerId].uploaded, "凭证未上传");
        return credentials[userId][issuerId].credData;
    }

    // uploadToken: 用户上传匿名投票令牌
    function uploadToken(bytes calldata tokHash, bytes calldata tokData, bytes calldata voteId) external {
        require(!tokens[tokHash].used, "令牌已使用");
        tokens[tokHash] = Token(tokData, voteId, true);
        emit TokenUploaded(tokHash, voteId);
    }

    // getToken: 获取令牌 (用于验证/追踪)
    function getToken(bytes calldata tokHash) external view returns (bytes memory) {
        require(tokens[tokHash].used, "令牌不存在");
        return tokens[tokHash].tokData;
    }

    // uploadTi / getTi: 临时值 T_i 的上传和获取 (证明计算)
    function uploadTi(bytes calldata key, bytes calldata value) external {
        tValues[key] = value;
    }
    function getTi(bytes calldata key) external view returns (bytes memory) {
        return tValues[key];
    }

    // uploadID / getID: 中间值 ID 的上传和获取
    function uploadID(bytes calldata key, bytes calldata value) external {
        iDValues[key] = value;
    }
    function getID(bytes calldata key) external view returns (bytes memory) {
        return iDValues[key];
    }

    // uploadQi / getQi: 商值 Q_i 的上传和获取
    function uploadQi(bytes calldata key, bytes calldata value) external {
        qValues[key] = value;
    }
    function getQi(bytes calldata key) external view returns (bytes memory) {
        return qValues[key];
    }

    // uploadRev: 追踪者上传撤销信息
    function uploadRev(bytes calldata userId, bytes calldata revData) external {
        require(registrations[userId].exists, "用户不存在");
        revocations[userId] = Revocation(revData, true);
        emit RevUploaded(userId);
    }

    // getRev: 获取撤销信息 (验证时检查)
    function getRev(bytes calldata userId) external view returns (bytes memory) {
        require(revocations[userId].revoked, "未撤销");
        return revocations[userId].revData;
    }

    // isRevoked: 验证时检查凭证是否被撤销
    function isRevoked(bytes calldata tokHash) external view returns (bool) {
        // 基于令牌 hash 检查是否关联的凭证已被撤销
        // 实现取决于具体的撤销列表结构
    }
}
```

### 6.2 修改 VotingSystem.sol

```
// VotingSystem.sol 修改方案
// 目标: 支持匿名令牌验证, 移除直接地址依赖

contract VotingSystem {
    // 新增状态
    address public credentialManager;  // CredentialManager 合约地址

    // 修改投票结构
    struct Ballot {
        string title;
        string[] options;
        uint256 deadline;
        bool isOpen;
        mapping(string => uint256) voteCounts;
        mapping(bytes32 => bool) usedTokens;  // tokHash => 是否已使用
    }

    // 修改 castVote 接受令牌哈希而非地址
    function castVote(string memory _option, bytes32 tokHash) public {
        // 检查令牌未使用
        require(!latestBallot.usedTokens[tokHash], "令牌已使用过");
        // 其余逻辑不变
        latestBallot.voteCounts[_option]++;
        latestBallot.usedTokens[tokHash] = true;
        emit VoteCasted(tokHash, block.timestamp);
    }

    // 新增: 设置 CredentialManager 地址
    function setCredentialManager(address _cm) public {
        credentialManager = _cm;
    }
}
```

---

## 7. 安全分析

### 7.1 匿名性 (Theorem 1)

**声明**: 在 q-SDH 假设和 DDH 假设下, 验证者无法从 tok 中获取用户身份信息。

**证明要点**:
- **签名盲化**: σ'_1 = σ_1^r, σ'_2 = σ_2^r · (σ'_1)^t 使用随机数 (r, t) 盲化, 使签名在 G1 中均匀分布。给定两个候选令牌, 区别优势 = Adv_DDH。
- **URS 派生**: g̃' = g̃^{t} · Π_{i∈D̄} Ỹ_i^{m_i} 在不披露属性上使用 y^i 幂次隐藏, 基于 y 的未知性保证不可区分。
- **知识证明 Π2**: 零知识性质保证不泄露 usk。
- **撤销列表**: Rev 仅暴露 Ỹ_{q+1}^{usk}, 基于 DL 假设无法从中恢复 usk。

### 7.2 盲化 (Theorem 2)

**声明**: 发行者即使参与协议, 也无法将凭证与后续展示关联。

**证明要点**:
- **ElGamal 同态盲化**: 发行者签名在盲化密文 (α'_i, β'_i) 上, 用户通过减去随机盲因子 r'' 恢复明文签名。发行者看到的密文视图与最终签名统计独立。
- **随机重随机化**: Show 阶段应用独立随机 (r, t), 即使发行者看到 tok, 也无法关联到其签名的凭证。
- **不可关联性**: 即使用户展示相同凭证多次, 每次 (r, t) 独立选择, tok 分布在 G1 中均匀且独立。

### 7.3 可追踪性 (Theorem 3)

**声明**: 在 q-SDH 假设和 DL 假设下, 任何试图多次使用凭证或违规投票的用户, 至少 t_T 个追踪者合作可揭示其身份。

**证明要点**:
- **ElGamal 阈值加密**: usk 通过 Shamir 秘密共享拆分为 n_T 份, 每份用追踪者公钥加密。t_T 个追踪者合作可解密恢复 usk。
- **Feldman 承诺**: {D_j} 确保份额正确性, 防止用户提交不一致份额。
- **知识证明 Π1**: 强制用户使用真实 usk 生成 upk = h^{usk}, 绑定身份。
- **唯一注册**: 合约确保每个 id 只能注册一次, 防止女巫攻击。
- **重复投票检测**: 通过 tokHash 唯一性, 检测同一凭证的多次使用。

### 7.4 不可诬陷性 (Theorem 4)

**声明**: 诚实用户即使被 t_T 个追踪者合谋, 也无法被诬陷为违规者。

**证明要点**:
- **知识证明绑定**: Π1 证明用户知道 usk, 且 upk = h^{usk}。追踪者无法伪造此证明, 因此无法将任意身份与凭证绑定。
- **ElGamal 加密绑定**: {α_j, β_j} 和 {C̃_{1,i}, C̃_{2,i}} 中的加密是绑定的, 给定密文, 仅解密出唯一明文。
- **验证等式约束**: Show/Verify 中的配对等式 e(σ'_1, X̃·g̃'·ΠỸ_i^{m_i}) = e(σ'_2, g̃) 确保证符与属性的一致性。追踪者无法修改 tok 中的属性而不破坏验证。
- **协议可提取性**: Π2 的证明者知识提取器可提取 usk, 证明只有 usk 所有者能生成有效令牌。

---

## 8. 与现有系统的集成方案

### 8.1 新增文件结构

```
blockvote/
├── crypto/
│   ├── pairing.js              # 双线性配对操作封装
│   ├── setup.js                # Setup 算法实现
│   ├── keygen.js               # TTPKeyGen + TraceKeyGen
│   ├── ukeygen.js              # UKeyGen
│   ├── obtain.js               # Obtain 协议 (用户端)
│   ├── issue.js                # Issue 协议 (发行者端)
│   ├── credagg.js              # CredAgg 聚合
│   ├── show.js                 # Show 令牌派生
│   ├── verify.js               # Verify 验证
│   ├── trace.js                # Trace 追踪
│   ├── revoke.js               # Revoke 撤销
│   └── nizk.js                 # 非交互式零知识证明工具
├── contracts/
│   ├── VotingSystem.sol        # 修改: 支持匿名令牌
│   └── CredentialManager.sol   # 新增: 凭证管理合约
├── migrations/
│   └── 3_deploy_credential.js  # 部署 CredentialManager
├── services/
│   ├── ttpService.js           # TTP 服务 (初始化)
│   ├── issuerService.js        # 发行者服务
│   └── tracerService.js        # 追踪者服务
├── routes/
│   └── credentialRoutes.js     # 凭证相关 API 路由
└── app.js                      # 修改: 集成凭证验证
```

### 8.2 修改后端端点

| 现有端点 | 修改内容 |
|---------|---------|
| `/createVote` | 增加: 验证创建者持有有效凭证 |
| `/vote` | 增加: 接收 tok, 调用 Verify 验证, 检查撤销列表 |
| `/getContracts` | 增加: 使用 tok 替代 publicKey |
| `/getHistoryContracts` | 增加: 使用 tok 替代 publicKey |

### 8.3 新增后端端点

| 方法 | 路由 | 描述 |
|------|------|------|
| POST | `/register` | 用户注册 (Obtain 协议) |
| POST | `/issueCredential` | 发行者签发部分凭证 |
| POST | `/aggregateCredential` | 用户聚合凭证 (CredAgg) |
| POST | `/showToken` | 生成匿名投票令牌 (Show) |
| POST | `/verifyToken` | 验证令牌 (Verify) |
| POST | `/trace` | 追踪违规用户 (Trace, 需 t_T 签名) |
| POST | `/revoke` | 撤销凭证 (Revoke, 需 t_T 签名) |

---

## 9. 性能分析

| 操作 | 计算复杂度 | 链上存储 | 说明 |
|------|-----------|---------|------|
| Setup | O(n_I + n_T) | 1 tx | 一次性初始化 |
| TTPKeyGen | O(n_I·q) | O(n_I) | 为每个发行者生成密钥 |
| Obtain/Issue | O(q + n_T) | O(q·n_T) | 用户交互式注册 |
| CredAgg | O(t_I) | 0 | 链下计算 |
| Show | O(q) | O(1) | 生成匿名令牌 |
| Verify | O(k) | 0 | k = 披露属性数 |
| Trace | O(t_T·N) | O(N) | N = 用户总数 |
| Revoke | O(t_T) | O(1) | 更新撤销列表 |

---