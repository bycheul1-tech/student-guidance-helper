const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('db:load'),
  saveStudent: st => ipcRenderer.invoke('student:save', st),
  deleteStudent: id => ipcRenderer.invoke('student:delete', id),
  listConsults: sid => ipcRenderer.invoke('consult:list', sid),
  getConsult: id => ipcRenderer.invoke('consult:get', id),
  deleteConsult: id => ipcRenderer.invoke('consult:delete', id),
  saveOutcome: (id, outcome, result) => ipcRenderer.invoke('consult:outcome', { id, outcome, result }),
  saveSettings: s => ipcRenderer.invoke('settings:save', s),
  setFollowUp: (id, due) => ipcRenderer.invoke('consult:followup', { id, due }),
  onHistory: fn => ipcRenderer.on('history:refresh', () => fn()),
  geminiLogin: () => ipcRenderer.invoke('gemini:login'),
  previewPrompt: (studentId, request) => ipcRenderer.invoke('prompt:preview', { studentId, request }),
  run: (studentId, request, models) => ipcRenderer.invoke('consult:run', { studentId, request, models }),
  retry: (id, key) => ipcRenderer.invoke('consult:retry', { id, key }),
  rerunCommon: id => ipcRenderer.invoke('consult:common', id),
  onUpdate: fn => ipcRenderer.on('consult:update', (_e, c) => fn(c)),
});
