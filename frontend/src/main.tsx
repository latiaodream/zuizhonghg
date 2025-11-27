import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'

console.log('🚀 main.tsx loading...')

// 错误边界组件
class ErrorBoundary extends React.Component {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: any) {
    console.error('❌ React错误边界捕获错误:', error)
    return { hasError: true, error }
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('❌ React组件错误详情:', { error, errorInfo })
  }

  render() {
    if ((this.state as any).hasError) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: '#ff0000' }}>
          <h1>❌ 应用启动错误</h1>
          <pre>{String((this.state as any).error)}</pre>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )
    }
    return (this.props as any).children
  }
}

// 全局错误捕获
window.onerror = (message, source, lineno, colno, error) => {
  console.error('❌ 全局JavaScript错误:', { message, source, lineno, colno, error })
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ 未处理的Promise拒绝:', event.reason)
})

// 渲染应用
const root = document.getElementById('root')
if (root) {
  console.log('✅ 找到root元素，开始渲染...')

  const reactRoot = ReactDOM.createRoot(root)
  reactRoot.render(
    <React.StrictMode>
      <ErrorBoundary>
        <ConfigProvider locale={zhCN}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ConfigProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )

  console.log('✅ 智投系统渲染完成')
} else {
  console.error('❌ 未找到root元素')
  document.body.innerHTML = '<h1 style="color: red; text-align: center; margin-top: 50px;">❌ 根元素未找到</h1>'
}