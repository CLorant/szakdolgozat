import type { Point } from './types';

/**
 * Smooth freehand path using Catmull-Rom → cubic Bézier conversion.
 * Each segment passes exactly through the recorded points while the curve
 * remains tangentially smooth at every junction.
 */
export function generateFreehandPath(points: Point[]): string {
	if (points.length === 0) return '';
	if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
	if (points.length === 2) {
		return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
	}

	const tension = 0.5; // 0 = straight lines, 1 = very loose curves
	let d = `M ${r(points[0].x)},${r(points[0].y)}`;

	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[Math.min(points.length - 1, i + 2)];

		// Catmull-Rom → cubic Bézier control points
		const cp1x = p1.x + (p2.x - p0.x) * tension / 3;
		const cp1y = p1.y + (p2.y - p0.y) * tension / 3;
		const cp2x = p2.x - (p3.x - p1.x) * tension / 3;
		const cp2y = p2.y - (p3.y - p1.y) * tension / 3;

		d += ` C ${r(cp1x)},${r(cp1y)} ${r(cp2x)},${r(cp2y)} ${r(p2.x)},${r(p2.y)}`;
	}

	return d;
}

export function generateQuadraticBezierPath(points: Point[]): string {
	if (points.length < 2) return '';
	if (points.length === 2) {
		return `M ${r(points[0].x)},${r(points[0].y)} L ${r(points[1].x)},${r(points[1].y)}`;
	}
	const [start, control, end] = points;
	return `M ${r(start.x)},${r(start.y)} Q ${r(control.x)},${r(control.y)} ${r(end.x)},${r(end.y)}`;
}

export function generateCubicBezierPath(points: Point[]): string {
	if (points.length < 2) return '';
	if (points.length === 2) {
		return `M ${r(points[0].x)},${r(points[0].y)} L ${r(points[1].x)},${r(points[1].y)}`;
	}
	if (points.length === 3) {
		return `M ${r(points[0].x)},${r(points[0].y)} Q ${r(points[1].x)},${r(points[1].y)} ${r(points[2].x)},${r(points[2].y)}`;
	}
	const [start, cp1, cp2, end] = points;
	return `M ${r(start.x)},${r(start.y)} C ${r(cp1.x)},${r(cp1.y)} ${r(cp2.x)},${r(cp2.y)} ${r(end.x)},${r(end.y)}`;
}

export function generateArcPath(points: Point[]): string {
	if (points.length < 2) return '';
	const [start, end] = points;
	const rx = Math.abs(end.x - start.x) / 2;
	const ry = Math.abs(end.y - start.y) / 2;
	return `M ${r(start.x)},${r(start.y)} A ${r(rx)},${r(ry)} 0 0 1 ${r(end.x)},${r(end.y)}`;
}

function r(n: number): number {
	return Math.round(n * 10) / 10;
}