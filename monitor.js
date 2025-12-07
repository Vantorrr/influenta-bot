import { spawn } from 'child_process'

function startBot() {
  console.log('🚀 Запуск бота...')
  const bot = spawn('npm', ['run', 'start'], { stdio: 'inherit', shell: true })

  bot.on('close', (code) => {
    console.log(`❌ Бот упал с кодом ${code}. Перезапуск через 3 сек...`)
    setTimeout(startBot, 3000)
  })
}

startBot()

