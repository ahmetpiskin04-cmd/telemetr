/**
 * Ekran ızgarası: 56 px üst bar; altında izleme listesi | grafik | AI paneli.
 * Data-dense dashboard ölçüsü: 12 px aralık. Dar pencerede yan kolonlar daralır.
 */
export function DashboardLayout({ top, left, main, right }) {
  return (
    <div className="grid h-screen grid-cols-[272px_minmax(0,1fr)_340px] grid-rows-[56px_minmax(0,1fr)] gap-3 p-3 2xl:grid-cols-[320px_minmax(0,1fr)_400px]">
      <header className="col-span-3 min-w-0">{top}</header>
      <aside className="card min-h-0 overflow-hidden">{left}</aside>
      <main className="min-h-0 min-w-0">{main}</main>
      <aside className="card min-h-0 overflow-hidden">{right}</aside>
    </div>
  );
}
