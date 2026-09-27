self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
    if (!event.data) return;
    const data = event.data.json();
    event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, icon: '/icon192.png' }));
});
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
        for (const client of clients) if (new URL(client.url).origin === self.location.origin) return client.focus();
        return self.clients.openWindow('/');
    }));
});
