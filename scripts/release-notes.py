"""Extract the matching CHANGELOG section for a version tag."""
import argparse
import pathlib
import re

parser = argparse.ArgumentParser()
parser.add_argument('tag')
parser.add_argument('--output', required=True)
args = parser.parse_args()
version = args.tag[1:] if args.tag.startswith('v') else args.tag
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    parser.error('Expected a vX.Y.Z release tag')
root = pathlib.Path(__file__).resolve().parent.parent
text = (root / 'CHANGELOG.md').read_text()
match = re.search(r'^## ' + re.escape(version) + r'(?=\s|[（—]|$)[^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
if not match:
    parser.error('Version is missing from CHANGELOG.md')
if '待上线' in match.group(0).splitlines()[0]:
    parser.error('Mark the version released in CHANGELOG.md before tagging it')
output = pathlib.Path(args.output).resolve()
try:
    output.relative_to(root)
except ValueError:
    parser.error('Output must be inside the repository')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(match.group(1).strip() + '\n')
