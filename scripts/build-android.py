"""Build a private-distribution APK with official Android SDK tools, no Gradle cache outside this project."""
import os
import json
import pathlib
import secrets
import shutil
import subprocess
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
sdk = root / '.runtime/android-sdk'
jdk = next((root / '.runtime/tooling').glob('amazon-corretto-17*'))
tools = next(p for p in sdk.iterdir() if (p / 'aapt2').exists())
platform = next(p / 'android.jar' for p in sdk.iterdir() if (p / 'android.jar').exists())
run = root / 'artifacts' / ('android-build-' + secrets.token_hex(4))
run.mkdir(parents=True)
classes = run / 'classes'
classes.mkdir()
assets = run / 'assets'
assets.mkdir()
shutil.copytree(root / 'public', assets / 'public')
signing = root / '.runtime/signing'
signing.mkdir(mode=0o700, exist_ok=True)
password = signing / 'release-password.txt'
keystore = signing / 'bobo-release.p12'
if not password.exists():
    password.write_text(secrets.token_urlsafe(32))
    password.chmod(0o600)
env = dict(os.environ, JAVA_HOME=str(jdk), TMPDIR=str(root / '.runtime/tmp'), ANDROID_USER_HOME=str(root / '.runtime/android-user'))
env['PATH'] = str(jdk / 'bin') + os.pathsep + env['PATH']
env['JAVA_TOOL_OPTIONS'] = '-Djava.io.tmpdir=' + str(root / '.runtime/tmp')

def command(*args):
    subprocess.run([str(a) for a in args], cwd=root, env=env, check=True)

for name in ['aapt2', 'zipalign', 'apksigner', 'd8']:
    (tools / name).chmod(0o755)
if not keystore.exists():
    command(jdk / 'bin/keytool', '-genkeypair', '-alias', 'bobo', '-keystore', keystore, '-storetype', 'PKCS12', '-storepass:file', password, '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Bobo Todo, O=Bobo Personal App, C=CN')
    keystore.chmod(0o600)
source = root / 'android/app/src/main'
command(tools / 'aapt2', 'compile', '--dir', source / 'res', '-o', run / 'resources.zip')
command(tools / 'aapt2', 'link', '-o', run / 'base.apk', '-I', platform, '--manifest', source / 'AndroidManifest.xml', '--java', run / 'generated', '-A', assets, run / 'resources.zip')
java_files = list((source / 'java').rglob('*.java')) + list((run / 'generated').rglob('*.java'))
command(jdk / 'bin/javac', '-encoding', 'UTF-8', '--release', '8', '-classpath', platform, '-d', classes, *java_files)
command(tools / 'd8', '--lib', platform, '--min-api', '26', '--output', run, *classes.rglob('*.class'))
with zipfile.ZipFile(run / 'base.apk', 'a', zipfile.ZIP_DEFLATED) as archive:
    archive.write(run / 'classes.dex', 'classes.dex')
command(tools / 'zipalign', '-f', '-p', '4', run / 'base.apk', run / 'aligned.apk')
version = json.loads((root / 'package.json').read_text())['version']
output = root / f'releases/v{version}/BoboTodo-{version}-Android.apk'
output.parent.mkdir(parents=True, exist_ok=True)
command(tools / 'apksigner', 'sign', '--ks', keystore, '--ks-key-alias', 'bobo', '--ks-pass', 'file:' + str(password), '--out', output, run / 'aligned.apk')
command(tools / 'apksigner', 'verify', '--verbose', '--print-certs', output)
command(tools / 'aapt2', 'dump', 'badging', output)
print('APK:', output)
