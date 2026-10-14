import axios from 'axios'
import { createMockAdapter } from '../mock/adapter'

// 拦截器在 T15 接入
export const http = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter(),
})
