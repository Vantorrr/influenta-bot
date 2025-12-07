import OpenAI from 'openai'
import config from './config'
import { getKnowledgeBase, getPlatformStats, searchBloggers, getUserAnalytics } from './database'

let openai: OpenAI | null = null

if (config.openaiApiKey) {
  openai = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://influenta.io',
      'X-Title': 'Influenta Support Bot',
    },
  })
}

const conversationHistory = new Map<number, Array<{ role: 'user' | 'assistant' | 'tool' | 'function', content: string | null, tool_calls?: any[], tool_call_id?: string }>>()

export function clearHistory(userId: number) {
  conversationHistory.delete(userId)
}

export async function getAIResponse(userId: number, userMessage: string): Promise<string> {
  if (!openai) {
    return 'AI-ответы временно недоступны. Нажмите "👤 Позвать оператора" для связи с поддержкой.'
  }

  try {
    const [knowledgeBase, stats] = await Promise.all([
      getKnowledgeBase(),
      getPlatformStats()
    ])

    let history = conversationHistory.get(userId) || []
    if (history.length > 10) history = history.slice(-10)

    // @ts-ignore
    history.push({ role: 'user', content: userMessage })

    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'search_bloggers',
          description: 'Искать блогеров по категории, цене или подписчикам',
          parameters: {
            type: 'object',
            properties: {
              category: { 
                type: 'string', 
                description: 'Категория на АНГЛИЙСКОМ (переведи запрос пользователя). Примеры: entertainment (юмор, развлечения), food (еда), travel (путешествия), lifestyle (лайфстайл), business (бизнес), crypto (крипта), fashion (мода), beauty (красота)' 
              },
              maxPrice: { type: 'number', description: 'Максимальная цена за пост' },
              minSubscribers: { type: 'number', description: 'Минимальное кол-во подписчиков' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_my_stats',
          description: 'Получить статистику текущего пользователя (меня)',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ]

    const systemPrompt = `Ты - веселый, дерзкий и супер-полезный AI-ассистент платформы Influenta 🚀

ТВОЙ СТИЛЬ:
- Общайся как "свой бро", но с уважением
- Используй много эмодзи 🔥💎🚀😎
- Шути, будь на позитиве, но отвечай по делу

АКТУАЛЬНАЯ СТАТИСТИКА:
- Блогеров: ${stats.bloggers} 🔥
- Рекламодателей: ${stats.advertisers} 💼
- Активных объявлений: ${stats.listings} 📢
- Общий охват: ${(stats.reach / 1000000).toFixed(1)}M+ 👁️

БАЗА ЗНАНИЙ:
${knowledgeBase}

ПРАВИЛА:
- Используй HTML теги для форматирования (Telegram поддерживает: <b>bold</b>, <i>italic</i>, <a href="url">link</a>)
- Если просят найти блогера -> используй search_bloggers
- В результатах поиска делай так:
  👤 <b><a href="link">Имя Блогера</a></b>
  💰 Цена: <b>1000₽</b>
  📊 Подписчиков: 50k
  🎭 Категория: Юмор
- НИКОГДА не придумывай username, используй только данные из функции
- Если спрашивают "какая у меня статистика" -> используй get_my_stats
- Если не знаешь -> предложи позвать оператора
- Всегда упоминай @influenta_bot`

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
    ]

    // Список моделей для fallback (платные, стабильные)
    const models = [
      'openai/gpt-4o-mini', // Основная модель ($0.15/1M токенов)
      'google/gemini-2.0-flash-exp:free', // Fallback на бесплатную
    ]

    let completion: any = null
    let lastError: any = null

    // Пробуем каждую модель с retry
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // @ts-ignore
          completion = await openai.chat.completions.create({
            model,
            messages: messages as any,
            tools,
            tool_choice: 'auto',
            temperature: 0.7,
          })
          break // Успех, выходим из обоих циклов
        } catch (err: any) {
          lastError = err
          if (err.status === 429 && attempt === 0) {
            console.log(`⏳ ${model} rate limited, retry через 3 сек...`)
            await new Promise(r => setTimeout(r, 3000))
          } else {
            console.log(`⚠️ Модель ${model} недоступна: ${err.status || err.message}`)
            break // Переходим к следующей модели
          }
        }
      }
      if (completion) break
    }

    if (!completion) {
      throw lastError || new Error('Все модели недоступны')
    }

    const message = completion.choices[0].message

    // Если AI хочет вызвать функцию
    if (message.tool_calls) {
      // @ts-ignore
      history.push(message) // Сохраняем вызов функции в историю

      for (const toolCall of message.tool_calls) {
        let functionResult = ''

        if (toolCall.function.name === 'search_bloggers') {
          const args = JSON.parse(toolCall.function.arguments)
          const bloggers = await searchBloggers(args)
          functionResult = bloggers.length > 0 
            ? JSON.stringify(bloggers) 
            : 'Блогеров по такому запросу не найдено. Предложи изменить критерии.'
        } else if (toolCall.function.name === 'get_my_stats') {
          const stats = await getUserAnalytics(userId)
          functionResult = stats || 'Не удалось найти твой профиль. Возможно, ты еще не зарегистрирован в боте.'
        }

        // @ts-ignore
        history.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: functionResult,
        })
      }

      // Второй запрос к AI с результатами функций (с fallback + retry)
      let secondCompletion: any = null
      for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            // @ts-ignore
            secondCompletion = await openai.chat.completions.create({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                ...history,
              ] as any,
            })
            break
          } catch (err: any) {
            if (err.status === 429 && attempt === 0) {
              console.log(`⏳ ${model} rate limited (2nd), retry...`)
              await new Promise(r => setTimeout(r, 3000))
            } else {
              console.log(`⚠️ Модель ${model} недоступна (2nd): ${err.status || err.message}`)
              break
            }
          }
        }
        if (secondCompletion) break
      }
      if (!secondCompletion) throw new Error('Все модели недоступны')

      const finalResponse = secondCompletion.choices[0].message.content || 'Что-то пошло не так...'
      // @ts-ignore
      history.push({ role: 'assistant', content: finalResponse })
      conversationHistory.set(userId, history)
      return finalResponse
    }

    // Если функции не нужны, просто возвращаем ответ
    const aiResponse = message.content || 'Не удалось получить ответ'
    // @ts-ignore
    history.push({ role: 'assistant', content: aiResponse })
    conversationHistory.set(userId, history)

    return aiResponse
  } catch (err) {
    console.error('Ошибка AI:', err)
    return 'Произошла ошибка при обработке запроса. Попробуйте позже или нажмите "👤 Позвать оператора".'
  }
}


