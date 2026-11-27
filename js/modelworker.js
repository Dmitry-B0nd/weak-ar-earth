// Фоновый поток: строит модели известных спутников (на слабом телефоне это 100–200 мс — главный поток не ждёт).
import { buildModel } from './models.js?v=0.22';
onmessage = (e) => {
  for (const kind of e.data) {
    const b = buildModel(kind);
    postMessage({ kind, ...b }, [b.body.v.buffer, b.body.idx.buffer, b.wing.v.buffer, b.wing.idx.buffer]);
  }
};
