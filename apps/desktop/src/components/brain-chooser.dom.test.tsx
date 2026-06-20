// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { BrainChooser } from './brain-chooser'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('BrainChooser', () => {
  it('shows a startup database load error', async () => {
    installFakeBridge({
      respond: (command) => {
        if (command === 'list_brains') return []
        return undefined
      },
    })

    renderWithProviders(
      <BrainChooser errorMessage="Could not open the remembered brain: database disk image is malformed" />,
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'database disk image is malformed',
    )
  })
})
