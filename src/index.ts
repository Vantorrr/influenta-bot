import dns from 'dns'
import { Telegraf, Markup, Context } from 'telegraf'
import config from './config'
import { getFAQ, createTicket } from './database'
import { getAIResponse, clearHistory } from './ai'

// В контейнерах Railway IPv6-маршрута к api.telegram.org может не быть,
// и запросы висят до ETIMEDOUT. Принудительно предпочитаем IPv4.
dns.setDefaultResultOrder('ipv4first')

console.log('🚀 Запуск Support Bot...')
console.log(`📱 Bot Token: ${config.botToken.substring(0, 10)}...`)
console.log(`👥 Админы: ${config.adminIds.join(', ')}`)

const bot = new Telegraf(config.botToken)

console.log('✅ Telegraf инициализирован')

// Хранилище активных тикетов (userId -> ticketId)
const activeTickets = new Map<number, number>()

// Хранилище режима ожидания сообщения для тикета
const waitingForTicketMessage = new Set<number>()

// Хранилище состояния ответа админа (adminId -> { userId, ticketId })
const adminReplyingState = new Map<number, { userId: number, ticketId: number }>()

const BOT_IMAGE = 'https://i.ibb.co/Q77xMjZp/176509059969352527a5778.png'

// Главное меню
function getMainMenu() {
  return Markup.keyboard([
    ['💬 Задать вопрос AI', '📚 Частые вопросы'],
    ['👤 Позвать оператора', '🔄 Начать заново'],
  ]).resize()
}

// Меню FAQ
async function getFAQMenu() {
  const faq = await getFAQ()
  const buttons = faq.map(item => [item.question])
  buttons.push(['⬅️ Назад в меню'])
  return Markup.keyboard(buttons).resize()
}

// Приветствие
bot.start(async (ctx) => {
  const firstName = ctx.from?.first_name || 'друг'
  
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: `👋 Привет, ${firstName}!

Я — AI-ассистент поддержки платформы Influenta 🚀

🤖 Могу ответить на вопросы о платформе
📚 Показать частые вопросы
👤 Связать с живым оператором

Выберите нужный раздел:`,
      // parse_mode: 'Markdown', // Отключаем чтобы избежать ошибок
      ...getMainMenu(),
    }
  )
})

// Обработка кнопок
bot.hears('💬 Задать вопрос AI', async (ctx) => {
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: '🤖 Отлично! Задавайте любой вопрос о платформе Influenta.\n\nНапример:\n• Как начать работу?\n• Сколько стоит?\n• Как найти блогера?\n\nЯ постараюсь помочь! 💡',
      ...getMainMenu()
    }
  )
})

bot.hears('📚 Частые вопросы', async (ctx) => {
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: '📚 Выберите интересующий вопрос:',
      ...await getFAQMenu()
    }
  )
})

bot.hears('👤 Позвать оператора', async (ctx) => {
  waitingForTicketMessage.add(ctx.from!.id)
  
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: '👤 Опишите вашу проблему или вопрос.\n\nОператор получит уведомление и ответит вам как можно скорее.',
      ...Markup.keyboard([['❌ Отменить']]).resize()
    }
  )
})

bot.hears('🔄 Начать заново', async (ctx) => {
  clearHistory(ctx.from!.id)
  waitingForTicketMessage.delete(ctx.from!.id)
  
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: '🔄 Начинаем заново!\n\nЧем могу помочь?',
      ...getMainMenu()
    }
  )
})

bot.hears('❌ Отменить', async (ctx) => {
  waitingForTicketMessage.delete(ctx.from!.id)
  
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: 'Отменено. Выберите другое действие:',
      ...getMainMenu()
    }
  )
})

bot.hears('⬅️ Назад в меню', async (ctx) => {
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: 'Главное меню:',
      ...getMainMenu()
    }
  )
})

// Обработка FAQ вопросов
bot.hears(/^(🚀|💰|📊|💬|✅)/, async (ctx) => {
  const faq = await getFAQ()
  const question = ctx.message.text
  const answer = faq.find(item => item.question === question)?.answer
  
  if (answer) {
    await ctx.reply(
      `${answer}\n\n━━━━━━━━━━━━━━━\n\nЕсли нужна дополнительная помощь, выберите:`,
      getMainMenu()
    )
  }
})

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const userId = ctx.from.id
  const text = ctx.message.text

  // 1. Проверяем, отвечает ли админ на тикет
  if (adminReplyingState.has(userId)) {
    const state = adminReplyingState.get(userId)!
    
    try {
      // Отправляем ответ пользователю
      await ctx.telegram.sendMessage(
        state.userId,
        `📬 Ответ поддержки (тикет #${state.ticketId}):\n\n${text}`
      )
      
      // Подтверждаем админу
      await ctx.reply(
        `✅ Ответ отправлен пользователю (тикет #${state.ticketId})`,
        Markup.inlineKeyboard([
          [Markup.button.callback('💬 Ответить еще', `reply_${state.ticketId}_${state.userId}`)],
          [Markup.button.callback('✅ Закрыть тикет', `close_${state.ticketId}_${state.userId}`)],
        ])
      )
      
      // Сбрасываем состояние ответа (админ должен снова нажать "Ответить" если хочет продолжить)
      adminReplyingState.delete(userId)
    } catch (err) {
      console.error('Не удалось отправить сообщение пользователю:', err)
      await ctx.reply('❌ Ошибка отправки сообщения пользователю (возможно, он заблокировал бота)')
    }
    return
  }

  // 2. Если пользователь создает тикет
  if (waitingForTicketMessage.has(userId)) {
    waitingForTicketMessage.delete(userId)
    
    const ticketId = await createTicket(userId, ctx.from.username, text)
    
    if (ticketId) {
      // Уведомляем админов
      for (const adminId of config.adminIds) {
        try {
          await ctx.telegram.sendMessage(
            adminId,
            `🎫 Новый тикет #${ticketId}\n\n👤 От: ${ctx.from.first_name} (@${ctx.from.username || 'без username'})\n🆔 ID: ${userId}\n\n💬 Сообщение:\n${text}`,
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Взять в работу', `take_${ticketId}_${userId}`)],
            ])
          )
        } catch (err) {
          console.error(`Не удалось отправить админу ${adminId}:`, err)
        }
      }
      
      activeTickets.set(userId, ticketId)
      
      await ctx.reply(
        `✅ Ваше обращение #${ticketId} отправлено операторам!\n\nМы ответим вам в ближайшее время. Обычно это занимает 5-15 минут.`,
        getMainMenu()
      )
    } else {
      await ctx.reply(
        '❌ Произошла ошибка при создании обращения. Попробуйте позже.',
        getMainMenu()
      )
    }
    return
  }

  // Если пользователь в режиме общения с оператором
  if (activeTickets.has(userId)) {
    const ticketId = activeTickets.get(userId)
    
    // Пересылаем админам
    for (const adminId of config.adminIds) {
      try {
        await ctx.telegram.sendMessage(
          adminId,
          `💬 Тикет #${ticketId} | ${ctx.from.first_name}:\n\n${text}`,
          Markup.inlineKeyboard([
            [Markup.button.callback('💬 Ответить', `reply_${ticketId}_${userId}`)],
            [Markup.button.callback('✅ Закрыть тикет', `close_${ticketId}_${userId}`)],
          ])
        )
      } catch (err) {
        console.error(`Не удалось отправить админу ${adminId}:`, err)
      }
    }
    
    await ctx.reply('✅ Сообщение отправлено оператору')
    return
  }

  // Обычный вопрос - отвечает AI
  await ctx.sendChatAction('typing')
  
  const aiResponse = await getAIResponse(userId, text)
  
  await ctx.replyWithPhoto(
    BOT_IMAGE,
    {
      caption: aiResponse.substring(0, 1024), // Telegram caption limit 1024 chars
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👍 Помогло', 'helpful_yes'), Markup.button.callback('👎 Не помогло', 'helpful_no')],
        [Markup.button.callback('👤 Нужен оператор', 'need_operator')],
      ]),
    }
  )
})

// Обработка колбэков
bot.action('helpful_yes', async (ctx) => {
  await ctx.answerCbQuery('Отлично! Рады помочь 😊')
  await ctx.editMessageReplyMarkup(undefined)
})

bot.action('helpful_no', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply(
    'Попробую ответить по-другому или нажмите "👤 Позвать оператора" для связи с живым специалистом.',
    getMainMenu()
  )
})

bot.action('need_operator', async (ctx) => {
  await ctx.answerCbQuery()
  waitingForTicketMessage.add(ctx.from!.id)
  
  await ctx.reply(
    '👤 Опишите вашу проблему или вопрос.\n\nОператор получит уведомление и ответит вам как можно скорее.',
    Markup.keyboard([['❌ Отменить']]).resize()
  )
})

// Админ берет тикет в работу
bot.action(/^take_(\d+)_(\d+)$/, async (ctx) => {
  if (!config.adminIds.includes(ctx.from.id)) {
    await ctx.answerCbQuery('У вас нет прав администратора')
    return
  }

  const ticketId = parseInt(ctx.match[1])
  const userId = parseInt(ctx.match[2])

  await ctx.answerCbQuery('Тикет взят в работу')
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: '✅ В работе', callback_data: 'noop' }],
      [{ text: '💬 Ответить', callback_data: `reply_${ticketId}_${userId}` }],
      [{ text: '✅ Закрыть', callback_data: `close_${ticketId}_${userId}` }],
    ],
  })

  // Уведомляем пользователя
  try {
    await ctx.telegram.sendMessage(
      userId,
      '✅ Оператор взял ваше обращение в работу! Скоро ответит.'
    )
  } catch (err) {
    console.error('Не удалось уведомить пользователя:', err)
  }
})

// Админ отвечает на тикет
bot.action(/^reply_(\d+)_(\d+)$/, async (ctx) => {
  if (!config.adminIds.includes(ctx.from.id)) {
    await ctx.answerCbQuery('У вас нет прав администратора')
    return
  }

  const ticketId = parseInt(ctx.match[1])
  const userId = parseInt(ctx.match[2])

  await ctx.answerCbQuery()
  await ctx.reply(
    `💬 Напишите ответ пользователю (тикет #${ticketId}):\n\nОтветьте на это сообщение.`
  )

  // Сохраняем состояние, что админ отвечает этому пользователю
  adminReplyingState.set(ctx.from.id, { userId, ticketId })
  
  await ctx.reply(
    '✍️ Введите текст ответа:',
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отмена ответа', 'cancel_reply')]
    ])
  )
})

bot.action('cancel_reply', async (ctx) => {
  if (adminReplyingState.has(ctx.from.id)) {
    adminReplyingState.delete(ctx.from.id)
    await ctx.answerCbQuery('Отмена ответа')
    await ctx.editMessageText('❌ Ответ отменен')
  } else {
    await ctx.answerCbQuery('Вы не в режиме ответа')
  }
})

// Админ закрывает тикет
bot.action(/^close_(\d+)_(\d+)$/, async (ctx) => {
  if (!config.adminIds.includes(ctx.from.id)) {
    await ctx.answerCbQuery('У вас нет прав администратора')
    return
  }

  const ticketId = parseInt(ctx.match[1])
  const userId = parseInt(ctx.match[2])

  activeTickets.delete(userId)

  await ctx.answerCbQuery('Тикет закрыт')
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [[{ text: '✅ Закрыт', callback_data: 'noop' }]],
  })

  // Уведомляем пользователя
  try {
    await ctx.telegram.sendMessage(
      userId,
      '✅ Ваше обращение закрыто.\n\nЕсли нужна дополнительная помощь, обращайтесь!',
      getMainMenu()
    )
  } catch (err) {
    console.error('Не удалось уведомить пользователя:', err)
  }
})

bot.action('noop', (ctx) => ctx.answerCbQuery())

// Запуск бота
console.log('🔌 Подключаемся к Telegram API...')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

;(async () => {
  // Сетевые сбои (ETIMEDOUT к api.telegram.org) бывают транзиентными,
  // поэтому не падаем с первой попытки, а повторяем с нарастающей паузой.
  const maxAttempts = 10

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Проверяем токен
      const me = await bot.telegram.getMe()
      console.log(`✅ Токен валиден! Бот: @${me.username}`)

      // Запускаем бота
      await bot.launch({
        dropPendingUpdates: true, // Игнорировать старые сообщения
      })

      console.log('🤖 Support bot запущен!')
      console.log(`📱 Бот: @${me.username}`)
      console.log(`👥 Админы: ${config.adminIds.join(', ')}`)
      console.log('✅ Бот готов к работе!')
      return
    } catch (err) {
      const delayMs = Math.min(30_000, 2_000 * attempt)
      console.error(`❌ Попытка ${attempt}/${maxAttempts} не удалась:`, err)

      if (attempt === maxAttempts) {
        console.error('❌ Не удалось запустить бота после всех попыток')
        process.exit(1)
      }

      console.log(`⏳ Повтор через ${delayMs / 1000} с...`)
      await sleep(delayMs)
    }
  }
})()

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

