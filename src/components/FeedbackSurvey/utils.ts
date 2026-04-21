export type FeedbackSurveyResponse =
  | 'good'
  | 'bad'
  | 'neutral'
  | 'up'
  | 'down'
  | string

export type FeedbackSurveyType = 'session' | 'memory' | 'post-compact' | string
