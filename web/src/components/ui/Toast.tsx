import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toastVariants = cva(
    'pointer-events-auto w-full max-w-sm rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-lg',
    {
        variants: {
            variant: {
                default: 'border-[var(--app-border)] bg-[var(--app-bg)]'
            }
        },
        defaultVariants: {
            variant: 'default'
        }
    }
)

export type ToastAction = {
    label: string
    onClick: () => void
}

export type ToastProps = React.HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof toastVariants> & {
    title: string
    body: string
    onClose?: () => void
    action?: ToastAction
}

export function Toast({ title, body, onClose, action, className, variant, ...props }: ToastProps) {
    const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        onClose?.()
    }

    const handleAction = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        action?.onClick()
        onClose?.()
    }

    return (
        <div className={cn(toastVariants({ variant }), className)} role="status" {...props}>
            <div className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-5">{title}</div>
                    {body ? <div className="mt-1 text-xs text-[var(--app-hint)]">{body}</div> : null}
                </div>
                {action ? (
                    <button
                        type="button"
                        className="text-xs font-medium text-[var(--app-link)] hover:opacity-80"
                        onClick={handleAction}
                    >
                        {action.label}
                    </button>
                ) : null}
                {onClose ? (
                    <button
                        type="button"
                        className="text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                        onClick={handleClose}
                        aria-label="Dismiss"
                    >
                        x
                    </button>
                ) : null}
            </div>
        </div>
    )
}
