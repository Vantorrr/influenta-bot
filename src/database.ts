import { Pool } from 'pg'
import config from './config'

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
})

// Проверка подключения
pool.on('connect', () => {
  console.log('✅ Подключено к PostgreSQL')
})

pool.on('error', (err) => {
  console.error('❌ Ошибка подключения к БД:', err)
})

// Функция для получения FAQ из базы
export async function getFAQ() {
  try {
    const result = await pool.query(`
      SELECT question, answer 
      FROM support_faq 
      WHERE active = true 
      ORDER BY priority ASC
    `)
    return result.rows
  } catch (err) {
    console.warn('FAQ не найдены в БД, используем дефолтные')
    return getDefaultFAQ()
  }
}

// Дефолтные FAQ если в БД нет
function getDefaultFAQ() {
  return [
    { question: '🚀 Как начать работу?', answer: 'Откройте @influenta_bot в Telegram, пройдите регистрацию за 1 минуту и начинайте!' },
    { question: '💰 Какая комиссия?', answer: 'Платформа полностью бесплатна! 0% комиссии для блогеров и рекламодателей.' },
    { question: '📊 Как смотреть статистику?', answer: 'Откройте профиль блогера - там видны охваты, вовлеченность и другие данные.' },
    { question: '💬 Как связаться с блогером?', answer: 'Нажмите "Предложить сотрудничество" на странице блогера - откроется встроенный чат.' },
    { question: '✅ Что такое верификация?', answer: 'Верифицированные блогеры прошли проверку администрации и подтвердили свою статистику.' },
  ]
}

// Создание тикета
export async function createTicket(userId: number, username: string | undefined, message: string) {
  try {
    const result = await pool.query(`
      INSERT INTO support_tickets (user_id, username, message, status, created_at)
      VALUES ($1, $2, $3, 'open', NOW())
      RETURNING id
    `, [userId, username || 'unknown', message])
    
    return result.rows[0]?.id
  } catch (err) {
    console.error('Ошибка создания тикета:', err)
    return null
  }
}

// Получение контекста для AI из базы
export async function getKnowledgeBase() {
  try {
    const result = await pool.query(`
      SELECT content, category 
      FROM support_knowledge_base 
      WHERE active = true
    `)
    
    return result.rows.map(row => `[${row.category}] ${row.content}`).join('\n\n')
  } catch (err) {
    console.warn('Knowledge base не найдена, используем дефолтную')
    return getDefaultKnowledgeBase()
  }
}

function getDefaultKnowledgeBase() {
  return `
[О платформе]
Influenta - это автоматизированная платформа для блогеров и рекламодателей в Telegram.
Работает как Telegram Mini App - не нужно скачивать приложения.
Полностью бесплатна, 0% комиссии.
Сейчас на платформе уже более 1000 блогеров и 1.2 млн аудитории!

[Регистрация]
1. Откройте @influenta_bot
2. Выберите роль (Блогер / Рекламодатель)
3. Заполните профиль
4. Готово! Можно начинать работу.

[Для блогеров]
- Создайте профиль с указанием охватов, цен за пост/сторис
- Получайте предложения от рекламодателей
- Общайтесь во встроенном чате
- Принимайте/отклоняйте заявки

[Для рекламодателей]
- Ищите блогеров по категориям, охватам, ценам
- Смотрите статистику каждого блогера
- Отправляйте предложения о сотрудничестве
- Создавайте свои объявления (Listings)

[Верификация]
Блогеры могут пройти верификацию:
1. Нажмите "Запросить верификацию" в профиле
2. Загрузите скриншоты статистики
3. Администрация проверит за 24 часа

[Тарифы]
Платформа полностью бесплатна.
Нет скрытых комиссий, подписок, платных функций.

[Безопасность]
- Все данные защищены
- Общение только через платформу
- Можно жаловаться на нарушения
`
}

// Получение реальной статистики платформы
export async function getPlatformStats() {
  try {
    // Считаем блогеров
    const bloggersCount = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'blogger'`)
    // Считаем рекламодателей
    const advertisersCount = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'advertiser'`)
    // Считаем объявления
    const listingsCount = await pool.query(`SELECT COUNT(*) FROM listings WHERE status = 'active'`)
    // Считаем общий охват (сумма подписчиков блогеров)
    const totalReach = await pool.query(`SELECT SUM("subscribersCount") FROM users WHERE role = 'blogger'`)

    return {
      bloggers: parseInt(bloggersCount.rows[0].count) || 0,
      advertisers: parseInt(advertisersCount.rows[0].count) || 0,
      listings: parseInt(listingsCount.rows[0].count) || 0,
      reach: parseInt(totalReach.rows[0].sum) || 0
    }
  } catch (err) {
    console.warn('Ошибка получения статистики:', err)
    return { bloggers: 1000, advertisers: 500, listings: 200, reach: 1200000 } // Fallback
  }
}

// Поиск блогеров (для AI)
export async function searchBloggers(params: { category?: string, maxPrice?: number, minSubscribers?: number }) {
  try {
    let query = `
      SELECT id, "firstName", "categories", "pricePerPost", "subscribersCount"
      FROM users 
      WHERE role = 'blogger' AND "isActive" = true
    `
    const values: any[] = []
    let paramIndex = 1

    if (params.category) {
      query += ` AND "categories" ILIKE $${paramIndex}`
      values.push(`%${params.category}%`)
      paramIndex++
    }

    if (params.maxPrice) {
      query += ` AND "pricePerPost" <= $${paramIndex}`
      values.push(params.maxPrice)
      paramIndex++
    }

    if (params.minSubscribers) {
      query += ` AND "subscribersCount" >= $${paramIndex}`
      values.push(params.minSubscribers)
      paramIndex++
    }

    query += ` ORDER BY "subscribersCount" DESC LIMIT 5`

    const result = await pool.query(query, values)
    
    // Формируем результат без username, но со ссылкой на платформу
    return result.rows.map(row => ({
      name: row.firstName,
      category: row.categories,
      price: row.pricePerPost,
      subscribers: row.subscribersCount,
      // Пробуем шортнейм 'app' (стандартный)
      link: `https://t.me/influenta_bot/app?startapp=blogger_${row.id}`
    }))
  } catch (err) {
    console.error('Ошибка поиска блогеров:', err)
    return []
  }
}

// Получение аналитики пользователя (для AI)
export async function getUserAnalytics(telegramId: number) {
  try {
    console.log(`🔍 getUserAnalytics called for telegramId: ${telegramId}`)
    // Получаем пользователя
    const userRes = await pool.query(`SELECT id, role, "firstName", "subscribersCount", "pricePerPost" FROM users WHERE "telegramId" = $1`, [telegramId.toString()])
    console.log(`📊 Query result:`, userRes.rows)
    const user = userRes.rows[0]

    if (!user) {
      console.log('❌ User not found!')
      return null
    }
    console.log(`✅ User found: ${user.firstName} (${user.role})`)

    let stats = `👤 ${user.firstName} (${user.role === 'blogger' ? 'Блогер' : 'Рекламодатель'})\n`
    
    if (user.role === 'advertiser') {
      // Считаем объявления
      const listingsRes = await pool.query(`SELECT COUNT(*) FROM listings WHERE "advertiserId" IN (SELECT id FROM advertisers WHERE "userId" = $1)`, [user.id])
      stats += `📢 Активных объявлений: ${listingsRes.rows[0].count}\n`
      
      // Считаем расходы (бюджет принятых офферов)
      const spentRes = await pool.query(`
        SELECT SUM("proposedBudget") 
        FROM offers 
        WHERE "advertiserId" IN (SELECT id FROM advertisers WHERE "userId" = $1) 
        AND status = 'accepted'
      `, [user.id])
      const spent = spentRes.rows[0].sum || 0
      stats += `💸 Потрачено (в работе): ${parseInt(spent).toLocaleString()}₽`

    } else {
      // Базовая статистика
      stats += `📊 Подписчиков (основной): ${user.subscribersCount}\n`
      stats += `💰 Цена за пост: ${user.pricePerPost}₽\n`

      // Другие соцсети
      const socialRes = await pool.query(`
        SELECT platform, username, "subscribersCount" 
        FROM social_platforms 
        WHERE "userId" = $1 AND "isActive" = true
      `, [user.id])

      if (socialRes.rows.length > 0) {
        stats += `\n🌐 Другие соцсети:\n`
        socialRes.rows.forEach(s => {
          stats += `- ${s.platform}: ${s.username} (${s.subscribersCount} подп.)\n`
        })
      }

      // Заработок (принятые офферы)
      // Ищем bloggerId в таблице bloggers по userId
      const bloggerRes = await pool.query(`SELECT id FROM bloggers WHERE "userId" = $1`, [user.id])
      if (bloggerRes.rows[0]) {
        const incomeRes = await pool.query(`
          SELECT SUM("proposedBudget") 
          FROM offers 
          WHERE "bloggerId" = $1 
          AND status = 'accepted'
        `, [bloggerRes.rows[0].id])
        
        const income = incomeRes.rows[0].sum || 0
        stats += `\n💵 Заработано (в работе): ${parseInt(income).toLocaleString()}₽`
      }
    }

    return stats
  } catch (err) {
    console.error('Ошибка аналитики:', err)
    return null
  }
}

export default pool

