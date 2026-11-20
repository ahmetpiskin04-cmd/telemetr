import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CircleHelp, Minus, TrendingDown, TrendingUp } from 'lucide-react';

// render.js başlıkta duruşu karakterle yazar (▲▼■?); panelde SVG ikon + metinle gösterilir
const STANCE = {
  '▲': { Icon: TrendingUp, className: 'bg-up/12 text-up', label: 'pozitif' },
  '▼': { Icon: TrendingDown, className: 'bg-down/12 text-down', label: 'negatif' },
  '■': { Icon: Minus, className: 'bg-surface-3 text-fg-muted', label: 'nötr' },
  '?': { Icon: CircleHelp, className: 'bg-surface-3 text-fg-muted', label: 'belirsiz' },
};

function textOf(children) {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  return textOf(children.props?.children);
}

/**
 * Panelde zaten gösterilen kısımları (başlık, model satırı, doğrulama bölümü) çıkarır;
 * bunlar üst kısımda yapılandırılmış olarak sunuluyor.
 */
export function stripReportChrome(markdown) {
  return markdown
    .replace(/^# .*\n+(_.*_\n+)?/, '')
    .replace(/## Doğrulama\n[\s\S]*?(?=\n## )/, '');
}

/**
 * Rapor Markdown'ı uygulamanın tipografisine uyarlanmış bileşenlerle çizilir.
 * react-markdown ham HTML'i çalıştırmaz; model çıktısı ve haber başlıkları güvenle gösterilir.
 * Varlık başlıklarındaki semboller tıklanınca grafik o sembole geçer.
 */
export function MarkdownReport({ markdown, symbols, onSelectSymbol, simple = false }) {
  const known = new Set(symbols);

  const components = {
    h1: () => null,
    h2: ({ children }) => (
      <h2 className="mt-6 mb-2.5 flex items-center gap-3 text-xs font-semibold tracking-wide text-fg-dim uppercase first:mt-1 after:h-px after:flex-1 after:bg-line">
        {children}
      </h2>
    ),
    h3: ({ children }) => {
      const text = textOf(children).trim();
      const icon = text[0];
      const symbol = text.match(/[A-Z][A-Z0-9_]{2,}/)?.[0];
      const rest = symbol ? text.slice(text.indexOf(symbol) + symbol.length) : text;
      return (
        <h3 className="mt-5 mb-2 flex items-baseline gap-2 border-t border-line pt-4 text-sm first:mt-0 first:border-t-0 first:pt-0">
          {STANCE[icon] && (
            <span className={`flex size-5 shrink-0 items-center justify-center self-center rounded-md ${STANCE[icon].className}`}>
              {(() => {
                const { Icon, label } = STANCE[icon];
                return <Icon size={12} strokeWidth={2.5} aria-label={label} />;
              })()}
            </span>
          )}
          {symbol && known.has(symbol) ? (
            <button type="button" onClick={() => onSelectSymbol(symbol)} className="font-semibold text-fg-strong underline-offset-2 transition-colors duration-150 hover:underline">
              {symbol}
            </button>
          ) : (
            <span className="font-semibold text-fg-strong">{symbol}</span>
          )}
          <span className="text-xs text-fg-dim">{rest}</span>
        </h3>
      );
    },
    p: ({ children }) => <p className="mb-3 leading-relaxed text-fg">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-fg-strong">{children}</strong>,
    em: ({ children }) => <em className="text-fg-muted not-italic">{children}</em>,
    ul: ({ children }) => <ul className="mb-3 space-y-1.5">{children}</ul>,
    ol: ({ children }) => <ol className="mb-3 list-decimal space-y-2.5 pl-5 marker:font-semibold marker:text-fg-dim">{children}</ol>,
    // Basit görünümde "Dayanak" satırları (THYAO.rsi=… gibi kanıt kodları) gizlenir
    li: ({ children }) =>
      simple && textOf(children).trim().startsWith('Dayanak:') ? null : <li className="leading-relaxed text-fg [ul>&]:relative [ul>&]:pl-3 [ul>&]:before:absolute [ul>&]:before:left-0 [ul>&]:before:text-fg-dim [ul>&]:before:content-['›']">{children}</li>,
    code: ({ children }) => (
      <code className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-fg">{children}</code>
    ),
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-series-1 underline-offset-2 hover:underline">
        {children}
      </a>
    ),
    table: ({ children }) => <table className="mb-3 w-full text-xs">{children}</table>,
    th: ({ children }) => <th className="border-b border-line py-1 text-left font-medium text-fg-muted">{children}</th>,
    td: ({ children }) => <td className="num border-b border-line/60 py-1">{children}</td>,
    hr: () => <hr className="my-3 border-line" />,
  };

  return (
    <div className="text-sm">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {stripReportChrome(markdown)}
      </Markdown>
    </div>
  );
}
