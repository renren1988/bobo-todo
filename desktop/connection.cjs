function validateUrl(value) {
    const url = new URL(value);
    if (url.origin !== 'https://bobo.taorenlove.live' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('请连接啵啵账号服务');
    return url.origin;
}
function validateRequest(value) {
    if (!value || !/^(tasks(?:\/[a-f0-9-]+)?|push|auth\/(register|login|recover|me|logout|migrate))$/.test(value.route) || !['GET', 'POST', 'PUT', 'DELETE'].includes(value.method)) throw new Error('请求不正确');
    if (typeof value.token !== 'string' || value.token.length > 256 || JSON.stringify(value.data || {}).length > 16384) throw new Error('请求不正确');
    return validateUrl(value.url);
}
module.exports = { validateUrl, validateRequest };
