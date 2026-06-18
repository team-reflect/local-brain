import { Fragment, type ReactNode } from 'react'

/** A compact label/value grid for detail headers. */
export function DetailFields({
  fields,
}: {
  fields: Array<{ label: string; value: ReactNode }>
}): ReactNode {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-sm">
      {fields.map((field) => (
        <Fragment key={field.label}>
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="text-foreground">{field.value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
