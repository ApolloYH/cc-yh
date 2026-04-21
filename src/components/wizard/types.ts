import type { ReactNode } from 'react'

export type WizardStepComponent<T = Record<string, any>> = (props: {
  data: T
}) => ReactNode

export type WizardContextValue<T = Record<string, any>> = {
  currentStepIndex: number
  totalSteps: number
  wizardData: T
  setWizardData: (data: T) => void
  updateWizardData: (updates: Partial<T>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  title?: string
  showStepCounter?: boolean
}

export type WizardProviderProps<T = Record<string, any>> = {
  steps: Array<WizardStepComponent<T>>
  initialData?: T
  onComplete: (data: T) => void
  onCancel?: () => void
  children?: ReactNode
  title?: string
  showStepCounter?: boolean
}
