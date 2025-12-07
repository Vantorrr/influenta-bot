import dotenv from 'dotenv'

dotenv.config()

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  databaseUrl: process.env.DATABASE_URL || '',
  adminIds: (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)),
  nodeEnv: process.env.NODE_ENV || 'development',
}

// Валидация
if (!config.botToken) {
  throw new Error('BOT_TOKEN не установлен в .env')
}

if (!config.openaiApiKey) {
  console.warn('⚠️ OPENAI_API_KEY не установлен - AI-ответы не будут работать')
}

if (!config.databaseUrl) {
  console.warn('⚠️ DATABASE_URL не установлен - подключение к БД недоступно')
}

if (config.adminIds.length === 0) {
  console.warn('⚠️ ADMIN_IDS не установлены - функция оператора не будет работать')
}

export default config

