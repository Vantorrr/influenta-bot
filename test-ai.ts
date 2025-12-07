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
  try {
    console.log('Testing GPT-4o-mini...')
    const completion = await openai.chat.completions.create({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say hello!' }],
    })
    console.log('Success:', completion.choices[0].message.content)
  } catch (err: any) {
    console.error('Error:', err.status, err.error)
  }
}

main()

