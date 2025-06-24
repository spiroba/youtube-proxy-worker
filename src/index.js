/**
 * YouTube Proxy Worker для обхода блокировки
 * Проксирует запросы к YouTube API через Cloudflare Edge
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Добавляем CORS заголовки для всех запросов
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  }

  // Обработка preflight запросов
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    })
  }

  try {
    const url = new URL(request.url)
    const targetUrl = url.searchParams.get('url')
    
    if (!targetUrl) {
      return new Response(JSON.stringify({
        error: 'Missing url parameter',
        usage: 'Add ?url=https://youtube.com/watch?v=VIDEO_ID'
      }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      })
    }

    // Проверяем, что это YouTube URL
    if (!targetUrl.includes('youtube.com') && !targetUrl.includes('youtu.be')) {
      return new Response(JSON.stringify({
        error: 'Only YouTube URLs are allowed'
      }), { 
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      })
    }

    // Заголовки для имитации браузера
    const proxyHeaders = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/',
      'Origin': 'https://www.google.com'
    }

    // Выполняем запрос к YouTube
    const response = await fetch(targetUrl, {
      headers: proxyHeaders,
      method: request.method,
      body: request.method !== 'GET' ? request.body : undefined,
      // Используем Cloudflare Edge для обхода гео-блокировки
      cf: {
        cacheEverything: false,
        cacheTtl: 0
      }
    })

    // Получаем контент
    let body = await response.text()
    let contentType = response.headers.get('content-type') || 'text/html'

    // Если это HTML страница, пытаемся извлечь данные плеера
    if (contentType.includes('text/html') && body.includes('ytInitialPlayerResponse')) {
      try {
        // Извлекаем JSON с данными плеера
        const playerStart = body.indexOf('var ytInitialPlayerResponse = ') + 30
        const playerEnd = body.indexOf(';</script>', playerStart)
        
        if (playerStart > 29 && playerEnd > playerStart) {
          const playerJson = body.substring(playerStart, playerEnd)
          const playerData = JSON.parse(playerJson)
          
          // Возвращаем структурированные данные
          return new Response(JSON.stringify({
            success: true,
            data: playerData,
            extractedAt: new Date().toISOString(),
            proxyInfo: {
              cloudflareRay: response.headers.get('cf-ray'),
              country: response.headers.get('cf-ipcountry')
            }
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          })
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError)
      }
    }

    // Если не удалось извлечь данные плеера, возвращаем сырой HTML
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': contentType,
        ...corsHeaders
      }
    })

  } catch (error) {
    console.error('Proxy error:', error)
    
    return new Response(JSON.stringify({
      error: 'Proxy request failed',
      message: error.message,
      timestamp: new Date().toISOString()
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }
}

// Дополнительная функция для обработки YouTube API запросов
async function handleYouTubeAPI(request) {
  const url = new URL(request.url)
  const videoId = url.searchParams.get('v')
  
  if (!videoId) {
    return new Response(JSON.stringify({
      error: 'Missing video ID parameter'
    }), { status: 400 })
  }

  try {
    // Различные методы получения данных о видео
    const methods = [
      `https://www.youtube.com/watch?v=${videoId}`,
      `https://m.youtube.com/watch?v=${videoId}`,
      `https://www.youtube.com/embed/${videoId}`,
      `https://youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    ]

    for (const targetUrl of methods) {
      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://www.google.com/'
          }
        })

        if (response.ok) {
          const body = await response.text()
          
          if (body.includes('ytInitialPlayerResponse') || body.includes('"title"')) {
            return new Response(JSON.stringify({
              success: true,
              method: targetUrl,
              data: body
            }), {
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              }
            })
          }
        }
      } catch (methodError) {
        console.log(`Method ${targetUrl} failed:`, methodError)
        continue
      }
    }

    return new Response(JSON.stringify({
      error: 'All methods failed',
      videoId: videoId
    }), { status: 404 })

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), { status: 500 })
  }
} 