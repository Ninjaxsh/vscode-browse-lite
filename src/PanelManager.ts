import type { ExtensionContext, Uri } from 'vscode'
import { commands, workspace } from 'vscode'
import * as EventEmitter from 'eventemitter2'

import { BrowserClient } from './BrowserClient'
import { getConfig, getConfigs } from './Config'
import { Panel } from './Panel'
import type { ExtensionConfiguration } from './ExtensionConfiguration'

export class PanelManager extends EventEmitter.EventEmitter2 {
  public panels: Set<Panel>
  public current: Panel | undefined
  public browser: BrowserClient
  public config: ExtensionConfiguration

  constructor(public readonly ctx: ExtensionContext) {
    super()
    this.panels = new Set()
    this.config = getConfigs(this.ctx)

    this.on('windowOpenRequested', (params) => {
      this.create(params.url)
    })
  }

  private async refreshSettings() {
    try {
      const prev = this.config
      this.config = {
        ...getConfigs(this.ctx),
        debugPort: prev.debugPort,
      }
    }
    catch (error) {
      console.error('Error refreshing settings:', error)
      throw error
    }
  }

  public async create(startUrl: string | Uri = this.config.startUrl) {
    try {
      await this.refreshSettings()

      if (!this.browser)
        this.browser = new BrowserClient(this.config, this.ctx)

      const panel = new Panel(this.config, this.browser)

      panel.once('disposed', async () => {
        try {
          if (this.current === panel) {
            this.current = undefined
            await commands.executeCommand('setContext', 'browse-lite-active', false)
          }
          this.panels.delete(panel)
          if (this.panels.size === 0) {
            await this.browser.dispose()
            this.browser = null
          }

          this.emit('windowDisposed', panel)
        }
        catch (error) {
          console.error('Error disposing panel:', error)
        }
      })

      panel.on('windowOpenRequested', (params) => {
        this.emit('windowOpenRequested', params)
      })

      panel.on('focus', async () => {
        try {
          this.current = panel
          await commands.executeCommand('setContext', 'browse-lite-active', true)
        }
        catch (error) {
          console.error('Error setting focus context:', error)
        }
      })

      panel.on('blur', async () => {
        try {
          if (this.current === panel) {
            this.current = undefined
            await commands.executeCommand('setContext', 'browse-lite-active', false)
          }
        }
        catch (error) {
          console.error('Error setting blur context:', error)
        }
      })

      this.panels.add(panel)

      await panel.launch(startUrl.toString())

      this.emit('windowCreated', panel)

      this.ctx.subscriptions.push({
        dispose: () => panel.dispose(),
      })

      return panel
    }
    catch (error) {
      console.error('Error creating panel:', error)
      throw error
    }
  }

  public async createFile(filepath: string) {
    try {
      if (!filepath)
        return

      const panel = await this.create(`file://${filepath}`)
      if (getConfig('browse-lite.localFileAutoReload')) {
        const watcher = workspace.createFileSystemWatcher(filepath, true, false, false)
        panel.disposables.push(
          watcher.onDidChange(() => {
            panel.reload()
          }),
        )
      }
      return panel
    }
    catch (error) {
      console.error('Error creating file panel:', error)
      throw error
    }
  }

  public async disposeByUrl(url: string) {
    try {
      const disposePromises = Array.from(this.panels)
        .filter((panel: Panel) => panel.config.startUrl === url)
        .map(panel => panel.dispose())
      
      await Promise.all(disposePromises)
    }
    catch (error) {
      console.error('Error disposing panels by URL:', error)
      throw error
    }
  }
}
