import { describe, expect, it } from 'bun:test'
import * as crypto from 'node:crypto'
import {
  parseAdapterAction,
  verifyDingTalkSignature,
  verifyWeComSignature,
} from '../services/adapterWebhookParsers.js'

describe('adapter webhook parsers', () => {
  it('parses IM control actions', () => {
    expect(parseAdapterAction('/pause task-1')).toEqual({
      type: 'pause',
      targetId: 'task-1',
    })
    expect(parseAdapterAction('/resume')).toEqual({ type: 'resume' })
    expect(parseAdapterAction('/queue')).toEqual({ type: 'queue' })
    expect(parseAdapterAction('/status')).toEqual({ type: 'status' })
  })

  it('verifies DingTalk signatures', () => {
    const secret = 'ding-secret'
    const timestamp = '123456'
    const sign = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}\n${secret}`)
      .digest('base64')
    expect(verifyDingTalkSignature({ timestamp, sign, secret })).toBe(true)
  })

  it('verifies WeCom signatures', () => {
    const params = {
      token: 'wecom-token',
      timestamp: '123456',
      nonce: 'nonce',
      body: '{"hello":"world"}',
    }
    const signature = crypto
      .createHash('sha1')
      .update([params.token, params.timestamp, params.nonce, params.body].sort().join(''))
      .digest('hex')
    expect(verifyWeComSignature({ ...params, signature })).toBe(true)
  })
})
