(function (scope) {
    const sortTasks = tasks => [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity) || a.created.localeCompare(b.created));
    const reminderKey = task => `${task.id}:${task.due}:${task.reminder}`;
    const shouldRemind = (task, now = Date.now()) => !task.done && !!task.due && now >= Date.parse(task.due) - task.reminder * 60000 && now <= Date.parse(task.due) + 86400000;
    const helpers = { sortTasks, reminderKey, shouldRemind };
    if (typeof module !== 'undefined') module.exports = helpers;
    else scope.Bobo = helpers;
})(globalThis);
