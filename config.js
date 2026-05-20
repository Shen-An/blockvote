// 数据库配置
module.exports = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'blockvote',
    waitForConnections: true,
    connectionLimit: 10
  }
};