import { useEffect } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import Sidebar from './Sidebar';

/** Marketing / pitch capture: ?pitch=1 forces a white professional chrome. */
export default function Layout() {
  const [searchParams] = useSearchParams();
  const fullView = searchParams.get('fullView') === '1';
  const pitch = searchParams.get('pitch') === '1';

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (pitch) {
      root.setAttribute('data-pitch', '1');
      body.classList.add('pitch-light');
      body.classList.remove('bg-surface-900', 'text-slate-100');
      body.classList.add('bg-white', 'text-slate-900');
    } else {
      root.removeAttribute('data-pitch');
      body.classList.remove('pitch-light', 'bg-white', 'text-slate-900');
      body.classList.add('bg-surface-900', 'text-slate-100');
    }
    return () => {
      root.removeAttribute('data-pitch');
      body.classList.remove('pitch-light', 'bg-white', 'text-slate-900');
      body.classList.add('bg-surface-900', 'text-slate-100');
    };
  }, [pitch]);

  return (
    <div className={`flex min-h-screen ${pitch ? 'pitch-shell' : ''}`}>
      {!fullView && <Sidebar />}
      <main className={`flex flex-1 flex-col overflow-hidden ${fullView ? 'min-w-0' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
