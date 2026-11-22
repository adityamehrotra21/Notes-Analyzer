import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { documentsApi, MAX_FILE_MB, MAX_FILES } from '../api/documents.js';
import { getErrorMessage } from '../api/client.js';

const REJECTION_TEXT = {
  'file-invalid-type': 'use PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), an image or a text file',
  'file-too-large': `must be ${MAX_FILE_MB} MB or smaller`,
  'too-many-files': `upload up to ${MAX_FILES} files at a time`,
};

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
};

export default function UploadDropzone({ onUploaded }) {
  const [progress, setProgress] = useState(null); // null = idle, 0-100 = uploading

  const onDrop = async (accepted) => {
    if (!accepted.length) return;
    setProgress(0);
    try {
      const docs = await documentsApi.upload(accepted, setProgress);
      const dupes = docs.filter((d) => d.duplicate);
      const fresh = docs.length - dupes.length;
      if (fresh) toast.success(`Uploaded ${fresh} file${fresh > 1 ? 's' : ''}. Processing…`);
      for (const d of dupes) {
        toast(`${d.filename} was already uploaded, so the existing copy is used.`, { icon: '♻️' });
      }
      onUploaded?.(docs);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    } finally {
      setProgress(null);
    }
  };

  const onDropRejected = (rejections) => {
    const seen = new Set();
    for (const { file, errors } of rejections) {
      const code = errors[0]?.code;
      if (code === 'too-many-files') {
        if (!seen.has(code)) toast.error(REJECTION_TEXT[code]);
        seen.add(code);
      } else toast.error(`${file.name}: ${REJECTION_TEXT[code] ?? errors[0]?.message}`);
    }
  };

  const uploading = progress !== null;
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPT,
    maxSize: MAX_FILE_MB * 1024 * 1024,
    maxFiles: MAX_FILES,
    disabled: uploading,
  });

  return (
    <div
      {...getRootProps()}
      className={`dropzone cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        isDragActive ? 'border-indigo-500 bg-indigo-50/60 dark:border-indigo-400 dark:bg-indigo-950/30' : ''
      } ${uploading ? 'pointer-events-none opacity-80' : ''}`}
    >
      <input {...getInputProps()} aria-label="Upload PDF files" />
      <FileUp className={`mx-auto h-8 w-8 ${isDragActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted'}`} aria-hidden />
      {uploading ? (
        <div className="mx-auto mt-4 max-w-xs">
          <p className="text-sm font-medium">Uploading… {progress}%</p>
          <div className="progress-track mt-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm font-medium">{isDragActive ? 'Drop to upload' : 'Drag files here, or click to browse'}</p>
          <p className="text-muted mt-1 text-xs">
            PDF, Word, PowerPoint, Excel, images (PNG, JPG, WEBP) or text. Up to {MAX_FILES} files, {MAX_FILE_MB} MB each.
          </p>
        </>
      )}
    </div>
  );
}
