import { EventEmitter } from 'events'
import { platform } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'
import edge from '@chiragrupani/karma-chromium-edge-launcher'
import chrome from 'karma-chrome-launcher'
import type { Browser } from 'puppeteer-core'
import puppeteer from 'puppeteer-core'
import type { ExtensionContext } from 'vscode'
import { window, workspace } from 'vscode'
import type { ExtensionConfiguration } from './ExtensionConfiguration'
import { tryPort } from './Config'
import { BrowserPage } from './BrowserPage'

export class BrowserClient extends EventEmitter {
  private browser: Browser

  constructor(private config: ExtensionConfiguration, private ctx: ExtensionContext) {
    super()
  }

  private async launchBrowser() {
    try {
      const chromeArgs = []

      this.config.debugPort = await tryPort(this.config.debugPort)

      chromeArgs.push(`--remote-debugging-port=${this.config.debugPort}`)
      chromeArgs.push('--allow-file-access-from-files')
      chromeArgs.push('--remote-allow-origins=*')

      if (this.config.proxy && this.config.proxy.length > 0)
        chromeArgs.push(`--proxy-server=${this.config.proxy}`)

      if (this.config.otherArgs && this.config.otherArgs.length > 0)
        chromeArgs.push(this.config.otherArgs)

      const chromePath = this.config.chromeExecutable || this.getChromiumPath()

      if (!chromePath) {
        throw new Error('No Chrome installation found, or no Chrome executable set in the settings')
      }

      if (platform() === 'linux')
        chromeArgs.push('--no-sandbox')

      const extensionSettings = workspace.getConfiguration('browse-lite')
      const ignoreHTTPSErrors = extensionSettings.get<boolean>('ignoreHttpsErrors')

      let userDataDir
      if (this.config.storeUserData)
        userDataDir = join(this.ctx.globalStorageUri.fsPath, 'UserData')

      this.browser = await puppeteer.launch({
        executablePath: chromePath,
        args: chromeArgs,
        ignoreHTTPSErrors,
        ignoreDefaultArgs: ['--mute-audio'],
        userDataDir,
      })

      // close the initial empty page
      const pages = await this.browser.pages()
      await Promise.all(pages.map(page => page.close()))
    }
    catch (error) {
      window.showErrorMessage(`Failed to launch browser: ${error.message}`)
      throw error
    }
  }

  public async newPage(): Promise<BrowserPage> {
    try {
      if (!this.browser)
        await this.launchBrowser()

      const page = new BrowserPage(this.browser, await this.browser.newPage())
      await page.launch()
      return page
    }
    catch (error) {
      window.showErrorMessage(`Failed to create new page: ${error.message}`)
      throw error
    }
  }

  public async dispose(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close()
        this.browser = null
      }
    }
    catch (error) {
      window.showErrorMessage(`Failed to dispose browser: ${error.message}`)
      throw error
    }
  }

  public getChromiumPath(): string | undefined {
    const knownChromiums = [...Object.entries(chrome), ...Object.entries(edge)]

    for (const [key, info] of knownChromiums) {
      if (!key.startsWith('launcher'))
        continue

      const path = info?.[1]?.prototype?.DEFAULT_CMD?.[process.platform]
      if (path && typeof path === 'string' && existsSync(path))
        return path
    }

    return undefined
  }
}
