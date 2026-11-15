import { memo } from 'react';
import { AlertCircle, Square } from 'lucide-react';
import MarkdownView from '../Markdown.jsx';
import CitationChip from './CitationChip.jsx';

function ChatMessage({ message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
          {message.content}
        </div>
      </div>
    );
  }

  const thinking = message.status === 'streaming' && !message.content;
  return (
    <div className="max-w-[92%] space-y-2">
      <div className="text-sm leading-relaxed">
        {thinking ? (
          <span className="text-muted inline-flex items-center gap-1" aria-label="Thinking">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
          </span>
        ) : (
          <MarkdownView sources={message.sources ?? []}>{message.content}</MarkdownView>
        )}
        {message.status === 'streaming' && message.content && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-zinc-400 align-middle dark:bg-zinc-500" aria-hidden />
        )}
      </div>

      {message.status === 'error' && (
        <p className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {message.error}
        </p>
      )}
      {message.status === 'stopped' && (
        <p className="text-muted flex items-center gap-1.5 text-xs">
          <Square className="h-3 w-3" aria-hidden /> Stopped
        </p>
      )}
      {message.citations?.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Sources">
          {message.citations.map((s) => (
            <CitationChip key={s.tag} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ChatMessage);
