@echo off
REM 关闭回显，提高执行的清晰度

pnpm run build & pnpm run pack & code --uninstall-extension antfu.browse-lite & code --install-extension ./browse-lite-0.3.9.vsix --force

REM 在操作完成后暂停屏幕显示
pause
