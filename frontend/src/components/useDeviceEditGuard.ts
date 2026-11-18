import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { useUi } from './ui';

export function useDeviceEditGuard(dirty: boolean, saving: boolean) {
  const { dialog, toast } = useUi();
  const blocker = useBlocker(dirty || saving);
  const latest = useRef(blocker);
  latest.current = blocker;
  const blocked = blocker.state === 'blocked';

  useEffect(() => {
    if (!blocked || latest.current.state !== 'blocked') return;
    if (saving) {
      latest.current.reset();
      toast('Tunggu sampai perubahan selesai disimpan.', 'warn');
      return;
    }
    let active = true;
    void dialog({
      title: 'Buang perubahan?',
      body: 'Ada perubahan yang belum disimpan.',
      ok: 'Buang perubahan',
      cancel: 'Lanjut edit',
      danger: true,
    }).then((answer) => {
      if (!active || latest.current.state !== 'blocked') return;
      if (answer) latest.current.proceed();
      else latest.current.reset();
    });
    return () => { active = false; };
  }, [blocked, saving, dialog, toast]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, saving]);
}
