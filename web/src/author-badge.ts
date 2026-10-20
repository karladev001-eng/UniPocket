/** Only the explicit server value grants this visual marker. */
export const ADMIN_NAME = 'Uni Pocket運営';
export const shieldPath = 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6';
export function adminBadge(kind: unknown): string {
    return kind === 'admin' ? `<span class="admin-badge"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${shieldPath}"/></svg>管理者</span>` : '';
}
export function adminBadgeNode(kind: unknown): HTMLElement | null {
    if (kind !== 'admin')
        return null;
    const badge = document.createElement('span');
    badge.className = 'admin-badge';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', shieldPath);
    svg.append(path);
    badge.append(svg, '管理者');
    return badge;
}
