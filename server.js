/**
 * MioVo Local Bridge Server
 * 
 * このサーバーはローカル環境で実行され、WebアプリケーションとVOICEVOX/RVCサービス間の
 * ブリッジとして機能します。WebSocketを使用してリアルタイム通信を行います。
 */

import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import axios from 'axios'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Configuration
const PORT = process.env.PORT || 8080
const VOICEVOX_URL = process.env.VOICEVOX_URL || 'http://localhost:50021'
const RVC_URL = process.env.RVC_URL || 'http://localhost:10102'

// Express app setup
const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// File upload setup
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
})

// Ensure upload directory exists
await fs.mkdir('uploads', { recursive: true })
await fs.mkdir('models', { recursive: true })

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    version: '1.0.0',
    services: {
      voicevox: VOICEVOX_URL,
      rvc: RVC_URL
    }
  })
})

// Start HTTP server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌉 MioVo Local Bridge Server`)
  console.log(`📡 HTTP Server: http://localhost:${PORT}`)
  console.log(`🔗 VOICEVOX: ${VOICEVOX_URL}`)
  console.log(`🔗 RVC: ${RVC_URL}`)
})

// WebSocket server setup
const wss = new WebSocketServer({ server })

// Connection tracking
const clients = new Map()

// Service status checking
async function checkServiceStatus(url) {
  try {
    const response = await axios.get(url, { timeout: 2000 })
    return response.status === 200
  } catch {
    return false
  }
}

// Periodic service status check
async function updateServiceStatus() {
  const voicevoxStatus = await checkServiceStatus(VOICEVOX_URL)
  const rvcStatus = await checkServiceStatus(RVC_URL + '/health')
  
  const statusMessage = {
    type: 'service-status',
    data: {
      voicevox: voicevoxStatus,
      rvc: rvcStatus,
      timestamp: new Date().toISOString()
    }
  }
  
  // Broadcast to all connected clients
  for (const [_, client] of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(statusMessage))
    }
  }
}

// Check service status every 5 seconds
setInterval(updateServiceStatus, 5000)

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = uuidv4()
  const clientIp = req.socket.remoteAddress
  
  console.log(`✅ New client connected: ${clientId} from ${clientIp}`)
  clients.set(clientId, ws)
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connected',
    data: { clientId, message: 'ローカルブリッジサーバーに接続しました' }
  }))
  
  // Immediately check and send service status
  updateServiceStatus()
  
  // Message handler
  ws.on('message', async (message) => {
    try {
      const request = JSON.parse(message.toString())
      console.log(`📨 Request from ${clientId}:`, request.type)
      
      switch (request.type) {
        case 'ping':
          ws.send(JSON.stringify({ 
            type: 'pong', 
            data: { timestamp: Date.now() },
            requestId: request.requestId
          }))
          break
          
        case 'voicevox-speakers':
          try {
            const response = await axios.get(`${VOICEVOX_URL}/speakers`)
            ws.send(JSON.stringify({
              type: 'voicevox-speakers-response',
              data: response.data,
              requestId: request.requestId
            }))
          } catch (error) {
            console.log('VOICEVOX not available, returning mock speakers')
            // Return mock speakers when VOICEVOX is not available
            ws.send(JSON.stringify({
              type: 'voicevox-speakers-response',
              data: [
                { 
                  speaker_id: 0, 
                  name: 'Default',
                  speaker_uuid: 'default-uuid',
                  styles: [
                    { id: 0, name: 'ノーマル' }
                  ]
                },
                { 
                  speaker_id: 1, 
                  name: 'Female',
                  speaker_uuid: 'female-uuid',
                  styles: [
                    { id: 1, name: 'ノーマル' }
                  ]
                },
                { 
                  speaker_id: 2, 
                  name: 'Male',
                  speaker_uuid: 'male-uuid',
                  styles: [
                    { id: 2, name: 'ノーマル' }
                  ]
                }
              ],
              requestId: request.requestId
            }))
          }
          break
          
        case 'voicevox-synthesis':
          try {
            // Step 1: Generate audio query
            const queryResponse = await axios.post(
              `${VOICEVOX_URL}/audio_query`,
              null,
              {
                params: {
                  text: request.data.text,
                  speaker: request.data.speaker_id || 3
                }
              }
            )
            
            // Step 2: Apply custom parameters if provided
            const audioQuery = queryResponse.data
            if (request.data.params) {
              Object.assign(audioQuery, request.data.params)
            }
            
            // Step 3: Synthesize audio
            const synthesisResponse = await axios.post(
              `${VOICEVOX_URL}/synthesis`,
              audioQuery,
              {
                params: { speaker: request.data.speaker_id || 3 },
                responseType: 'arraybuffer'
              }
            )
            
            // Convert to base64
            const audioBase64 = Buffer.from(synthesisResponse.data).toString('base64')
            
            ws.send(JSON.stringify({
              type: 'voicevox-synthesis-response',
              data: {
                audio: `data:audio/wav;base64,${audioBase64}`,
                text: request.data.text,
                speaker_id: request.data.speaker_id
              },
              requestId: request.requestId
            }))
          } catch (error) {
            console.log('VOICEVOX not available, returning mock audio')
            // Return a mock audio response when VOICEVOX is not available
            // This is a small silent WAV file (100ms of silence)
            const mockWav = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQAAAAA='
            
            ws.send(JSON.stringify({
              type: 'voicevox-synthesis-response',
              data: {
                audio: `data:audio/wav;base64,${mockWav}`,
                text: request.data.text,
                speaker_id: request.data.speaker_id,
                mock: true
              },
              requestId: request.requestId
            }))
          }
          break
          
        case 'rvc-upload-training-data':
          try {
            const { fileName, fileData, fileSize } = request.data
            const filePath = path.join(__dirname, 'uploads', `${uuidv4()}_${fileName}`)
            
            // Save base64 data to file
            const buffer = Buffer.from(fileData.split(',')[1], 'base64')
            await fs.writeFile(filePath, buffer)
            
            // Process with RVC (mock for now, replace with actual RVC API)
            ws.send(JSON.stringify({
              type: 'rvc-upload-response',
              data: {
                id: uuidv4(),
                fileName,
                filePath,
                fileSize,
                status: 'processing'
              },
              requestId: request.requestId
            }))
            
            // Simulate processing completion
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: 'rvc-processing-complete',
                data: {
                  fileName,
                  status: 'ready',
                  duration: Math.random() * 300 // Mock duration
                }
              }))
            }, 2000)
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'ファイルアップロードエラー: ' + error.message,
              requestId: request.requestId
            }))
          }
          break
          
        case 'rvc-start-training':
          try {
            const { modelName, trainingDataIds, epochs, params } = request.data
            const modelId = uuidv4()
            
            // Start training (mock for now)
            ws.send(JSON.stringify({
              type: 'rvc-training-started',
              data: {
                modelId,
                modelName,
                status: 'training',
                totalEpochs: epochs
              },
              requestId: request.requestId
            }))
            
            // Simulate training progress
            let currentEpoch = 0
            const progressInterval = setInterval(() => {
              currentEpoch += 10
              
              ws.send(JSON.stringify({
                type: 'rvc-training-progress',
                data: {
                  modelId,
                  currentEpoch,
                  totalEpochs: epochs,
                  progress: (currentEpoch / epochs) * 100
                }
              }))
              
              if (currentEpoch >= epochs) {
                clearInterval(progressInterval)
                ws.send(JSON.stringify({
                  type: 'rvc-training-complete',
                  data: {
                    modelId,
                    modelName,
                    status: 'ready',
                    modelPath: path.join(__dirname, 'models', `${modelId}.pth`)
                  }
                }))
              }
            }, 1000)
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'トレーニング開始エラー: ' + error.message,
              requestId: request.requestId
            }))
          }
          break
          
        case 'rvc-voice-conversion':
          try {
            const { inputAudio, modelId, params } = request.data
            
            // Perform voice conversion (mock for now)
            ws.send(JSON.stringify({
              type: 'rvc-conversion-response',
              data: {
                convertedAudio: inputAudio, // Mock: return same audio
                modelId,
                duration: 3.5
              },
              requestId: request.requestId
            }))
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              error: '音声変換エラー: ' + error.message,
              requestId: request.requestId
            }))
          }
          break
          
        case 'voicevox_request':
          try {
            const { endpoint, method = 'GET', body, params } = request.data.payload || {}
            
            if (!endpoint) {
              ws.send(JSON.stringify({
                type: 'error',
                error: 'エンドポイントが指定されていません',
                requestId: request.requestId
              }))
              break
            }
            
            const url = `${VOICEVOX_URL}${endpoint}`
            console.log(`🔗 VOICEVOX Request: ${method} ${url}`)
            if (body) {
              console.log(`📦 Request body type: ${typeof body}, keys: ${Object.keys(body).slice(0, 5).join(', ')}`)
            }
            
            // Prepare axios config
            const axiosConfig = {
              method: method.toUpperCase(),
              url,
              timeout: 30000
            }
            
            // Add query parameters if provided
            if (params) {
              axiosConfig.params = params
            }
            
            // Add request body if provided (for POST/PUT)
            if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
              axiosConfig.data = body
            }
            
            // Handle binary responses (e.g., audio files)
            if (endpoint.includes('/synthesis') || endpoint.includes('/audio')) {
              axiosConfig.responseType = 'arraybuffer'
            }
            
            // Make the request
            const response = await axios(axiosConfig)
            
            // Prepare response data
            let responseData = response.data
            
            // Convert binary data to base64 if needed
            if (response.data instanceof ArrayBuffer || Buffer.isBuffer(response.data)) {
              const audioBase64 = Buffer.from(response.data).toString('base64')
              responseData = {
                audio: `data:audio/wav;base64,${audioBase64}`,
                contentType: response.headers['content-type'] || 'audio/wav'
              }
            }
            
            ws.send(JSON.stringify({
              type: 'voicevox_request-response',
              data: responseData,
              requestId: request.requestId
            }))
          } catch (error) {
            console.error('VOICEVOX request error:', error.message)
            ws.send(JSON.stringify({
              type: 'error',
              error: `VOICEVOX APIエラー: ${error.response?.statusText || error.message}`,
              details: error.response?.data,
              requestId: request.requestId
            }))
          }
          break
          
        default:
          ws.send(JSON.stringify({
            type: 'error',
            error: `Unknown request type: ${request.type}`,
            requestId: request.requestId
          }))
      }
    } catch (error) {
      console.error('Message handling error:', error)
      ws.send(JSON.stringify({
        type: 'error',
        error: 'メッセージ処理エラー: ' + error.message
      }))
    }
  })
  
  // Connection close handler
  ws.on('close', () => {
    console.log(`❌ Client disconnected: ${clientId}`)
    clients.delete(clientId)
  })
  
  // Error handler
  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error)
  })
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down bridge server...')
  
  // Close all WebSocket connections
  for (const [clientId, client] of clients) {
    client.send(JSON.stringify({
      type: 'server-shutdown',
      data: { message: 'サーバーがシャットダウンしています' }
    }))
    client.close()
  }
  
  wss.close()
  server.close()
  
  // Clean up temp files
  try {
    await fs.rm('uploads', { recursive: true, force: true })
  } catch {}
  
  process.exit(0)
})

console.log('🚀 Bridge server is ready!')
