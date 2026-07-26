import { useState, useEffect } from 'react';
import api from '@/api/client';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { LoadingState } from '@/shared/LoadingState';
import type { AdminStatsData } from '@/api/types';

export function AdminDashboardPage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<AdminStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const res = await api.get<{ success: boolean; stats: AdminStatsData }>('/api/admin/stats');
      setStats(res.stats);
    } catch {
      toast('error', '获取统计数据失败');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <LoadingState message="加载统计数据…" />;
  }

  if (!stats) {
    return <p style={{ color: 'var(--color-error)' }}>无法加载统计数据</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-6)' }}>
        仪表盘
      </h1>

      {/* User Stats */}
      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>总用户</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.users.total}</p>
        </Card>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>今日注册</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.users.today}</p>
        </Card>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>本周注册</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.users.week}</p>
        </Card>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>已验证</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.users.verified}</p>
        </Card>
      </div>

      {/* Login Stats */}
      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>今日登录</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.logins.today}</p>
        </Card>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>本周登录</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.logins.week}</p>
        </Card>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Web 登录</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.logins.web}</p>
        </Card>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>OAuth 登录</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.logins.oauth}</p>
        </Card>
      </div>

      {/* OAuth Stats */}
      <div className="grid grid--2" style={{ marginBottom: 'var(--space-6)' }}>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>OAuth 客户端</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.oauth.clients}</p>
        </Card>
        <Card padding="md">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>授权记录</p>
          <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>{stats.oauth.authorizations}</p>
        </Card>
      </div>

      {/* Trends */}
      <div className="grid grid--2">
        <Card>
          <CardTitle>7天用户增长</CardTitle>
          <div className="stack stack--sm">
            {stats.trends.userGrowth.map((point) => (
              <div key={point.date} className="cluster cluster--spread">
                <span style={{ fontSize: 'var(--text-sm)' }}>{point.date}</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>{point.count}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>7天登录趋势</CardTitle>
          <div className="stack stack--sm">
            {stats.trends.loginTrend.map((point) => (
              <div key={point.date} className="cluster cluster--spread">
                <span style={{ fontSize: 'var(--text-sm)' }}>{point.date}</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>{point.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
