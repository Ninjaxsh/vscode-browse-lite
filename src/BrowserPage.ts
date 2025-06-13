import EventEmitterEnhancer, { EnhancedEventEmitter } from 'event-emitter-enhancer'
import type { Browser, CDPSession, Page } from 'puppeteer-core'
import { Clipboard } from './Clipboard'
import { isDarkTheme } from './Config'

enum ExposedFunc {
  EmitCopy = 'EMIT_BROWSER_LITE_ON_COPY',
  GetPaste = 'EMIT_BROWSER_LITE_GET_PASTE',
  EnableCopyPaste = 'ENABLE_BROWSER_LITE_HOOK_COPY_PASTE',
}

export class BrowserPage extends EnhancedEventEmitter {
  private client: CDPSession
  private clipboard: Clipboard

  constructor(
    public readonly browser: Browser,
    public readonly page: Page,
  ) {
    super()
    this.clipboard = new Clipboard()
  }

  get id(): string {
    return this.page.mainFrame()._id
  }

  public async dispose() {
    try {
      this.removeAllElseListeners()
      this.removeAllListeners()
      
      if (this.client) {
        await this.client.detach()
      }

      await Promise.allSettled([
        this.page.removeExposedFunction(ExposedFunc.EnableCopyPaste),
        this.page.removeExposedFunction(ExposedFunc.EmitCopy),
        this.page.removeExposedFunction(ExposedFunc.GetPaste),
      ])

      await this.page.close()
    }
    catch (error) {
      console.error('Error disposing BrowserPage:', error)
      throw error
    }
  }

  public async send(action: string, data: object = {}, callbackId?: number) {
    try {
      switch (action) {
        case 'Page.goForward':
          await this.page.goForward()
          break
        case 'Page.goBackward':
          await this.page.goBack()
          break
        case 'Clipboard.readText':
          try {
            const text = await this.clipboard.readText()
            this.emit({
              callbackId,
              result: text,
            } as any)
          }
          catch (error) {
            this.emit({
              callbackId,
              error: error.message,
            } as any)
          }
          break
        default:
          try {
            const result = await this.client.send(action as any, data)
            this.emit({
              callbackId,
              result,
            } as any)
          }
          catch (error) {
            this.emit({
              callbackId,
              error: error.message,
            } as any)
          }
      }
    }
    catch (error) {
      console.error(`Error in BrowserPage.send(${action}):`, error)
      this.emit({
        callbackId,
        error: error.message,
      } as any)
    }
  }

  public async launch(): Promise<void> {
    try {
      await Promise.allSettled([
        this.page.exposeFunction(ExposedFunc.EnableCopyPaste, () => true),
        this.page.exposeFunction(ExposedFunc.EmitCopy, (text: string) => this.clipboard.writeText(text)),
        this.page.exposeFunction(ExposedFunc.GetPaste, () => this.clipboard.readText()),
      ])

      await this.page.evaluateOnNewDocument(() => {
        // custom embedded devtools
        localStorage.setItem('screencastEnabled', 'false')
        localStorage.setItem('panel-selectedTab', 'console')

        // sync copy and paste
        if (window[ExposedFunc.EnableCopyPaste]?.()) {
          const copyHandler = (event: ClipboardEvent) => {
            const text = event.clipboardData?.getData('text/plain') || document.getSelection()?.toString()
            text && window[ExposedFunc.EmitCopy]?.(text)
          }
          document.addEventListener('copy', copyHandler)
          document.addEventListener('cut', copyHandler)
          document.addEventListener('paste', async (event) => {
            event.preventDefault()
            const text = await window[ExposedFunc.GetPaste]?.()
            text && document.execCommand('insertText', false, text)
          })
        }
      })

      await this.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: isDarkTheme() ? 'dark' : 'light' }])

      this.client = await this.page.target().createCDPSession()

      // @ts-expect-error
      EventEmitterEnhancer.modifyInstance(this.client)

      // @ts-expect-error
      this.client.else((action: string, data: object) => {
        this.emit({
          method: action,
          result: data,
        } as any)
      })
    }
    catch (error) {
      console.error('Error launching BrowserPage:', error)
      throw error
    }
  }
}
