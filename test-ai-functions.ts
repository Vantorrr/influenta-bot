import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: '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',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://influenta.io',
    'X-Title': 'Influenta Test',
  },
})

async function main() {
  const model = 'google/gemini-2.0-flash-exp:free' // Тестируем Gemini
  // const model = 'meta-llama/llama-3.1-70b-instruct:free'

  console.log(`Testing ${model}...`)

  try {
    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'search_bloggers',
          description: 'Search bloggers',
          parameters: {
            type: 'object',
            properties: {
              category: { type: 'string' },
            },
          },
        },
      },
    ]

    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Find crypto bloggers' }],
      tools,
      tool_choice: 'auto',
    })

    console.log('Response:', JSON.stringify(completion.choices[0].message, null, 2))
  } catch (err: any) {
    console.error('Error:', err.status, err.error)
  }
}

main()

