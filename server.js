// SMS to Telegram Forwarding Service
// REST API сервер для пересылки SMS-сообщений в Telegram

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

// Загрузка переменных окружения
dotenv.config();

// Создание экземпляра Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Защита от DDoS - ограничение запросов
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов за период
  message: { 
    status: 'error', 
    message: 'Слишком много запросов с этого IP, пожалуйста, попробуйте позже.' 
  }
});

// Применяем защиту от DDoS ко всем маршрутам /api
app.use('/api', apiLimiter);

// Middleware для проверки API-ключа
const checkApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  // API-ключ должен быть задан в переменных окружения
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ 
      status: 'error', 
      message: 'Недействительный API-ключ' 
    });
  }
  
  next();
};

// Хранилище данных (в памяти)
const devices = [];

// Функция для отправки сообщения в Telegram
const sendToTelegram = async (botToken, chatId, message) => {
  try {
    const telegramApi = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    await axios.post(telegramApi, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
    
    console.log(`[${new Date().toISOString()}] Сообщение успешно отправлено в Telegram`);
    return true;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка при отправке в Telegram:`, error.message);
    throw new Error(`Ошибка отправки в Telegram: ${error.message}`);
  }
};

// Эндпоинты API

// 1. Отправка сообщения в Telegram
app.post('/api/sendToTelegram', checkApiKey, async (req, res) => {
  try {
    const { botToken, chatId, message } = req.body;
    
    if (!botToken || !chatId || !message) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Отсутствуют обязательные параметры: botToken, chatId, message' 
      });
    }
    
    await sendToTelegram(botToken, chatId, message);
    
    res.json({ 
      status: 'success', 
      message: 'Сообщение успешно отправлено' 
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка в /api/sendToTelegram:`, error.message);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// 2. Регистрация устройства
app.post('/api/registerDevice', checkApiKey, (req, res) => {
  try {
    const { deviceId, botToken, chatId } = req.body;
    
    if (!deviceId || !botToken || !chatId) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Отсутствуют обязательные параметры: deviceId, botToken, chatId' 
      });
    }
    
    // Проверить, существует ли уже устройство
    const existingDeviceIndex = devices.findIndex(device => device.deviceId === deviceId);
    
    if (existingDeviceIndex !== -1) {
      // Обновить существующее устройство
      devices[existingDeviceIndex] = { deviceId, botToken, chatId };
      console.log(`[${new Date().toISOString()}] Устройство обновлено: ${deviceId}`);
      
      return res.json({ 
        status: 'success', 
        message: 'Устройство успешно обновлено', 
        deviceId 
      });
    }
    
    // Добавить новое устройство
    devices.push({ deviceId, botToken, chatId });
    console.log(`[${new Date().toISOString()}] Новое устройство зарегистрировано: ${deviceId}`);
    
    res.json({ 
      status: 'success', 
      message: 'Устройство успешно зарегистрировано', 
      deviceId 
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка в /api/registerDevice:`, error.message);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// 3. Обработка SMS и их пересылка в Telegram
app.post('/api/processSms', checkApiKey, async (req, res) => {
  try {
    const { deviceId, sender, message, timestamp } = req.body;
    
    if (!deviceId || !sender || !message) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Отсутствуют обязательные параметры: deviceId, sender, message' 
      });
    }
    
    // Найти устройство
    const device = devices.find(device => device.deviceId === deviceId);
    
    if (!device) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Устройство не зарегистрировано' 
      });
    }
    
    // Форматировать сообщение
    const formattedTime = timestamp 
      ? new Date(parseInt(timestamp)).toLocaleString('ru-RU') 
      : new Date().toLocaleString('ru-RU');
    
    const telegramMessage = `📱 <b>Новое SMS</b>\n\n` +
      `От: <b>${sender}</b>\n` +
      `Время: ${formattedTime}\n\n` +
      `Сообщение:\n${message}`;
    
    // Отправить в Telegram
    await sendToTelegram(device.botToken, device.chatId, telegramMessage);
    
    console.log(`[${new Date().toISOString()}] SMS обработано и переслано: от ${sender} для устройства ${deviceId}`);
    
    res.json({ 
      status: 'success', 
      message: 'SMS успешно обработано и переслано в Telegram' 
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ошибка в /api/processSms:`, error.message);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// Ping-эндпоинт для поддержания активности сервера
app.get('/ping', (req, res) => {
  res.json({ status: 'success', message: 'Сервер активен' });
});

// Обработка корневого маршрута
app.get('/', (req, res) => {
  res.json({ 
    status: 'success', 
    message: 'SMS to Telegram API работает', 
    version: '1.0.0'
  });
});

// Обработка несуществующих маршрутов
app.use('*', (req, res) => {
  res.status(404).json({ 
    status: 'error', 
    message: 'Маршрут не найден' 
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Сервер запущен на порту ${PORT}`);
});
