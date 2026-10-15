import { create } from 'zustand'

/**
 * 当前页面是否有未保存的表单内容。
 * 由表单页面同步写入，后台布局在“主动退出登录”前据此二次确认。
 */
export const useUnsavedStore = create(() => ({ dirty: false }))
