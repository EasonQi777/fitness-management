/**
 * 让浏览器下载一段文本：Blob + 临时对象 URL + 临时链接。
 * 点击后立即移除链接；对象 URL 在本轮事件结束后释放（给浏览器留出开始下载的时间），
 * 连续导出不会累积未释放的对象 URL。
 * @param {string} filename
 * @param {string} content
 * @param {string} type MIME 类型
 */
export function downloadText(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
