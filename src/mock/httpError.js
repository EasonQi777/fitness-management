import { ERROR_STATUS, createErrorBody } from '../api/errors'

/** 模拟服务内抛出的业务错误，由 handleRequest 转为对应的 HTTP 响应 */
export class MockHttpError extends Error {
  /**
   * @param {keyof typeof ERROR_STATUS} code
   * @param {string} message
   * @param {object} [extra] fieldErrors / invalidOrders
   */
  constructor(code, message, extra) {
    super(message)
    this.status = ERROR_STATUS[code]
    this.body = createErrorBody(code, message, extra)
  }
}
