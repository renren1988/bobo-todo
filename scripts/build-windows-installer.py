"""Compile the NSIS installer on Linux without running Windows programs or changing the host."""
import os
import pathlib
import subprocess
import json

root = pathlib.Path(__file__).resolve().parent.parent
bundle = next((root / '.cache/electron-builder/nsis-3.0.4.1').glob('*/linux/makensis')).parent.parent
plugins = next((root / '.cache/electron-builder/nsis-resources-3.4.1').glob('*/plugins/x86-unicode'))
version = json.loads((root / 'package.json').read_text())['version']
app = root / f'releases/v{version}/windows/win-unpacked'
output = root / f'releases/v{version}/windows/BoboTodo-{version}-Windows-Setup.exe'
assert (app / 'resources/app-update.yml').is_file(), 'Updater config missing; run the full Windows build first'
script = root / f'artifacts/BoboTodo-installer-{version}.nsi'
# Delete only files in this build manifest; leave unrelated files and user settings intact.
remove_files = '\n'.join('  Delete "$INSTDIR\\' + str(f.relative_to(app)).replace('/', '\\') + '"' for f in sorted(app.rglob('*')) if f.is_file())
remove_dirs = '\n'.join('  RMDir "$INSTDIR\\' + str(d.relative_to(app)).replace('/', '\\') + '"' for d in sorted((p for p in app.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True))
script.write_text(f'''Unicode true
!include "MUI2.nsh"
!addplugindir "{plugins}"
Name "啵啵待办"
OutFile "{output}"
InstallDir "$LOCALAPPDATA\\Programs\\BoboTodo"
InstallDirRegKey HKCU "Software\\BoboTodo" "InstallDir"
RequestExecutionLevel user
SetCompressor zlib
Icon "{root / 'desktop/icon.ico'}"
UninstallIcon "{root / 'desktop/icon.ico'}"
VIProductVersion "{version}.0"
VIAddVersionKey "ProductName" "啵啵待办"
VIAddVersionKey "FileDescription" "BoboTodo Windows Installer"
VIAddVersionKey "FileVersion" "{version}"
VIAddVersionKey "LegalCopyright" "Bobo Todo"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\BoboTodo.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section "Install"
  SetShellVarContext current
  nsExec::ExecToLog 'taskkill /F /IM BoboTodo.exe /T'
  Sleep 1200
  Pop $0
  WriteRegStr HKCU "Software\\BoboTodo" "InstallDir" "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "{app}/*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\\啵啵待办"
  CreateShortcut "$SMPROGRAMS\\啵啵待办\\啵啵待办.lnk" "$INSTDIR\\BoboTodo.exe"
  CreateShortcut "$DESKTOP\\啵啵待办.lnk" "$INSTDIR\\BoboTodo.exe"
  WinShell::SetLnkAUMI "$SMPROGRAMS\\啵啵待办\\啵啵待办.lnk" "com.bobo.todo"
  WinShell::SetLnkAUMI "$DESKTOP\\啵啵待办.lnk" "com.bobo.todo"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BoboTodo" "DisplayName" "啵啵待办"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BoboTodo" "DisplayVersion" "{version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BoboTodo" "DisplayIcon" "$INSTDIR\\BoboTodo.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BoboTodo" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BoboTodo" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BoboTodo" "NoRepair" 1
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog 'taskkill /F /IM BoboTodo.exe /T'
  Pop $0
  Sleep 1200
{remove_files}
{remove_dirs}
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\\啵啵待办.lnk"
  Delete "$SMPROGRAMS\\啵啵待办\\啵啵待办.lnk"
  RMDir "$SMPROGRAMS\\啵啵待办"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BoboTodo"
SectionEnd
''', encoding='utf-8')
env = dict(os.environ, NSISDIR=str(bundle), TMPDIR=str(root / '.runtime/tmp'))
subprocess.run([str(bundle / 'linux/makensis'), '-V2', str(script)], env=env, check=True)
print(output)
