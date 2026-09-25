"use client";

import { useEffect, useRef } from "react";
import {
  canPreviewProblemPhoto,
  problemPhotoType,
  PROBLEM_PHOTO_TYPES,
  type ProblemAttachment,
} from "@/lib/problem-attachments";

export interface PendingProblemPicture {
  id: string;
  file: File;
}

function PendingPreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  const previewable = canPreviewProblemPhoto(problemPhotoType(file) ?? "");
  useEffect(() => {
    if (!previewable || !image.current) return;
    const url = URL.createObjectURL(file);
    image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, previewable]);
  return previewable ? (
    // Blob URLs and session-protected pictures should not go through Next's image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={image} alt={`Preview of ${file.name}`} className="h-28 w-full rounded-t-lg bg-sand-100 object-contain" />
  ) : (
    <div className="flex h-28 items-center justify-center rounded-t-lg bg-sand-100 text-xs text-sand-500">HEIC / HEIF picture</div>
  );
}

export default function ProblemPictures({
  attachments, pending, disabled, currentUserEmail, canDelete, onChoose, onRemovePending, onRemoveSaved,
}: {
  attachments: ProblemAttachment[];
  pending: PendingProblemPicture[];
  disabled: boolean;
  currentUserEmail: string;
  canDelete: boolean;
  onChoose: (files: File[]) => void;
  onRemovePending: (id: string) => void;
  onRemoveSaved: (photo: ProblemAttachment) => void;
}) {
  return (
    <section aria-labelledby="problem-pictures-label" className="sm:col-span-2 lg:col-span-5">
      <h3 id="problem-pictures-label" className="text-sm font-medium text-sand-700">Pictures</h3>
      <p id="problem-pictures-help" className="mt-1 text-xs text-sand-500">
        Add photos of the problem, delivery or repair. JPEG, PNG, WebP, GIF, HEIC or HEIF, up to 4 MB each.
      </p>
      <input
        type="file"
        multiple
        accept={`${PROBLEM_PHOTO_TYPES.join(",")},.jpg,.jpeg,.png,.webp,.gif,.heic,.heif`}
        aria-label="Add pictures"
        aria-describedby="problem-pictures-help"
        disabled={disabled}
        onChange={(event) => {
          onChoose(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
        className="mt-3 block w-full rounded-lg border border-dashed border-sand-300 p-3 text-sm text-sand-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 disabled:opacity-50"
      />
      {(attachments.length > 0 || pending.length > 0) && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {attachments.map((photo) => (
            <li key={photo.id} className="min-w-0 overflow-hidden rounded-lg border border-sand-200 bg-white">
              <a
                href={`/api/problems/attachments/${photo.id}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${canPreviewProblemPhoto(photo.content_type) ? "Open" : "Download"} ${photo.filename}`}
                className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                {canPreviewProblemPhoto(photo.content_type) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/problems/attachments/${photo.id}`} alt={photo.filename} loading="lazy" className="h-28 w-full bg-sand-100 object-contain" />
                ) : (
                  <span className="flex h-28 items-center justify-center bg-sand-100 px-2 text-center text-xs text-blue-700">Download HEIC / HEIF picture</span>
                )}
              </a>
              <div className="space-y-1 p-2">
                <p className="truncate text-xs text-sand-600" title={photo.filename}>{photo.filename}</p>
                <p className="text-xs text-green-700">Saved</p>
                {(canDelete || photo.uploaded_by === currentUserEmail) && (
                  <button type="button" disabled={disabled} onClick={() => onRemoveSaved(photo)} aria-label={`Remove ${photo.filename}`} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40">Remove</button>
                )}
              </div>
            </li>
          ))}
          {pending.map(({ id, file }) => (
            <li key={id} className="min-w-0 overflow-hidden rounded-lg border border-blue-200 bg-white">
              <PendingPreview file={file} />
              <div className="space-y-1 p-2">
                <p className="truncate text-xs text-sand-600" title={file.name}>{file.name}</p>
                <p className="text-xs text-blue-700">Uploads when saved</p>
                <button type="button" disabled={disabled} onClick={() => onRemovePending(id)} aria-label={`Remove pending ${file.name}`} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40">Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
