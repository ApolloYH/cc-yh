import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { TEARDROP_ASTERISK } from '../../constants/figures.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { setClipboard } from '../../ink/termio/osc.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to copy link
import { Box, Link, Text, useInput } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { logEvent } from '../../services/analytics/index.js';
import { fetchReferralRedemptions, formatCreditAmount, getCachedOrFetchPassesEligibility } from '../../services/api/referral.js';
import type { ReferralRedemptionsResponse, ReferrerRewardInfo } from '../../services/oauth/types.js';
import { count } from '../../utils/array.js';
import { logError } from '../../utils/log.js';
import { Pane } from '../design-system/Pane.js';

type PassStatus = {
  passNumber: number;
  isAvailable: boolean;
};

type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};

export function Passes({
  onDone
}: Props): React.ReactNode {
  const [loading, setLoading] = useState(true);
  const [passStatuses, setPassStatuses] = useState<PassStatus[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referrerReward, setReferrerReward] = useState<ReferrerRewardInfo | null | undefined>(undefined);
  const exitState = useExitOnCtrlCDWithKeybindings(() => onDone('邀请通行证对话框已关闭', {
    display: 'system'
  }));
  const handleCancel = useCallback(() => {
    onDone('邀请通行证对话框已关闭', {
      display: 'system'
    });
  }, [onDone]);
  useKeybinding('confirm:no', handleCancel, {
    context: 'Confirmation'
  });
  useInput((_input, key) => {
    if (key.return && referralLink) {
      void setClipboard(referralLink).then(raw => {
        if (raw) process.stdout.write(raw);
        logEvent('tengu_guest_passes_link_copied', {});
        onDone('邀请链接已复制到剪贴板！');
      });
    }
  });
  useEffect(() => {
    async function loadPassesData() {
      try {
        const eligibilityData = await getCachedOrFetchPassesEligibility();
        if (!eligibilityData || !eligibilityData.eligible) {
          setIsAvailable(false);
          setLoading(false);
          return;
        }
        setIsAvailable(true);
        const referralDetails = eligibilityData.referral_code_details as {
          referral_link?: string;
          campaign?: string;
        } | undefined;
        if (referralDetails?.referral_link) {
          setReferralLink(referralDetails.referral_link);
        }
        setReferrerReward(eligibilityData.referrer_reward as ReferrerRewardInfo | null | undefined);
        const campaign = referralDetails?.campaign ?? 'claude_code_guest_pass';

        let redemptionsData: ReferralRedemptionsResponse;
        try {
          redemptionsData = await fetchReferralRedemptions(campaign);
        } catch (err_0) {
          logError(err_0 as Error);
          setIsAvailable(false);
          setLoading(false);
          return;
        }

        const redemptions = (redemptionsData.redemptions as unknown[] | undefined) || [];
        const maxRedemptions = Number(redemptionsData.limit ?? 3);
        const statuses: PassStatus[] = [];
        for (let i = 0; i < maxRedemptions; i++) {
          const redemption = redemptions[i];
          statuses.push({
            passNumber: i + 1,
            isAvailable: !redemption
          });
        }
        setPassStatuses(statuses);
        setLoading(false);
      } catch (err) {
        logError(err as Error);
        setIsAvailable(false);
        setLoading(false);
      }
    }
    void loadPassesData();
  }, []);
  if (loading) {
    return <Pane>
        <Box flexDirection="column" gap={1}>
          <Text dimColor>正在加载邀请通行证信息...</Text>
          <Text dimColor italic>
            {exitState.pending ? <>再按一次 {exitState.keyName} 退出</> : <>按 Esc 取消</>}
          </Text>
        </Box>
      </Pane>;
  }
  if (!isAvailable) {
    return <Pane>
        <Box flexDirection="column" gap={1}>
          <Text>当前暂无可用的邀请通行证。</Text>
          <Text dimColor italic>
            {exitState.pending ? <>再按一次 {exitState.keyName} 退出</> : <>按 Esc 取消</>}
          </Text>
        </Box>
      </Pane>;
  }
  const availableCount = count(passStatuses, p => p.isAvailable);
  const sortedPasses = [...passStatuses].sort((a, b) => +b.isAvailable - +a.isAvailable);
  const renderTicket = (pass: PassStatus) => {
    const isRedeemed = !pass.isAvailable;
    if (isRedeemed) {
      return <Box key={pass.passNumber} flexDirection="column" marginRight={1}>
          <Text dimColor>{'鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈺?'}</Text>
          <Text dimColor>{` ) CC ${TEARDROP_ASTERISK} 鈹娾暠`}</Text>
          <Text dimColor>{'鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈺?'}</Text>
        </Box>;
    }
    return <Box key={pass.passNumber} flexDirection="column" marginRight={1}>
        <Text>{'鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?'}</Text>
        <Text>
          {' ) CC '}
          <Text color="claude">{TEARDROP_ASTERISK}</Text>
          {' 鈹?( '}
        </Text>
        <Text>{'鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?'}</Text>
      </Box>;
  };
  return <Pane>
      <Box flexDirection="column" gap={1}>
        <Text color="permission">邀请通行证 · 剩余 {availableCount} 张</Text>

        <Box flexDirection="row" marginLeft={2}>
          {sortedPasses.slice(0, 3).map(pass_0 => renderTicket(pass_0))}
        </Box>

        {referralLink && <Box marginLeft={2}>
            <Text>{referralLink}</Text>
          </Box>}

        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>
            {referrerReward ? `把 claude-yh 的免费一周体验分享给朋友。如果对方喜欢并订阅，你将获得 ${formatCreditAmount(referrerReward)} 的额外额度继续使用。` : '把 claude-yh 的免费一周体验分享给朋友。'}
            <Link url={referrerReward ? 'https://support.claude.com/en/articles/13456702-claude-code-guest-passes' : 'https://support.claude.com/en/articles/12875061-claude-code-guest-passes'}>
              适用条款。
            </Link>
          </Text>
        </Box>

        <Box>
          <Text dimColor italic>
            {exitState.pending ? <>再按一次 {exitState.keyName} 退出</> : <>按回车复制链接 · 按 Esc 取消</>}
          </Text>
        </Box>
      </Box>
    </Pane>;
}
