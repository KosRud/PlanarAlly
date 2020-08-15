import { InvalidationMode, SyncMode } from "@/core/comm/types";
import { layerManager } from "@/game/layers/manager";
import { Circle } from "@/game/shapes/circle";
import { Shape } from "@/game/shapes/shape";
import { g2l, g2lr, g2lx, g2ly, g2lz, getUnitDistance } from "@/game/units";
import { getFogColour } from "@/game/utils";
import { getVisionSources } from "@/game/visibility/utils";
import { gameSettingsStore } from "../settings";
import { TriangulationTarget } from "../visibility/te/pa";
import { computeVisibility } from "../visibility/te/te";
import { FowLayer } from "./fow";
import { floorStore } from "./store";

export class FowLightingLayer extends FowLayer {
    addShape(shape: Shape, sync: SyncMode, invalidate: InvalidationMode, snappable = true): void {
        super.addShape(shape, sync, invalidate, snappable);
        if (shape.options.has("preFogShape") && shape.options.get("preFogShape")) {
            this.preFogShapes.push(shape);
        }
    }

    removeShape(shape: Shape, sync: SyncMode): boolean {
        let idx = -1;
        if (shape.options.has("preFogShape") && shape.options.get("preFogShape")) {
            idx = this.preFogShapes.findIndex(s => s.uuid === shape.uuid);
        }
        const remove = super.removeShape(shape, sync);
        if (remove && idx >= 0) this.preFogShapes.splice(idx, 1);
        return remove;
    }

    draw(): void {
        if (!this.valid) {
            const ctx = this.ctx;

            const originalOperation = ctx.globalCompositeOperation;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            ctx.fillStyle = "rgba(0, 0, 0, 1)";

            const activeFloor = floorStore.currentFloor.id;

            if (this.floor === activeFloor && this.canvas.style.display === "none")
                this.canvas.style.removeProperty("display");
            else if (this.floor !== activeFloor && this.canvas.style.display !== "none")
                this.canvas.style.display = "none";

            if (this.floor === activeFloor && floorStore.floors.length > 1) {
                for (const floor of floorStore.floors) {
                    if (floor.id !== floorStore.floors[0].id) {
                        const mapl = layerManager.getLayer(floor, "map");
                        if (mapl === undefined) continue;
                        ctx.globalCompositeOperation = "destination-out";
                        ctx.drawImage(mapl.canvas, 0, 0);
                    }
                    if (floor.id !== activeFloor) {
                        const fowl = layerManager.getLayer(floor, this.name);
                        if (fowl === undefined) continue;
                        ctx.globalCompositeOperation = "source-over";
                        ctx.drawImage(fowl.canvas, 0, 0);
                    }
                    if (floor.id === activeFloor) break;
                }
            }
            ctx.globalCompositeOperation = "source-over";

            // At all times provide a minimal vision range to prevent losing your tokens in fog.
            if (
                gameSettingsStore.fullFow &&
                layerManager.hasLayer(floorStore.currentFloor, "tokens") &&
                floorStore.currentFloor === floorStore.floors[floorStore.currentFloorindex]
            ) {
                for (const sh of layerManager.getLayer(floorStore.currentFloor, "tokens")!.getShapes()) {
                    if (!sh.ownedBy({ visionAccess: true }) || !sh.isToken) continue;
                    const bb = sh.getBoundingBox();
                    const lcenter = g2l(sh.center());
                    const alm = 0.8 * g2lz(bb.w);
                    ctx.beginPath();
                    ctx.arc(lcenter.x, lcenter.y, alm, 0, 2 * Math.PI);
                    const gradient = ctx.createRadialGradient(lcenter.x, lcenter.y, alm / 2, lcenter.x, lcenter.y, alm);
                    gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
                    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }
            }

            this.vCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

            // First cut out all the light sources
            for (const light of getVisionSources(this.floor)) {
                const shape = layerManager.UUIDMap.get(light.shape);
                if (shape === undefined) continue;
                const aura = shape.auras.find(a => a.uuid === light.aura);
                if (aura === undefined) continue;

                if (!shape.ownedBy({ visionAccess: true }) && !aura.visible) continue;

                const auraLength = getUnitDistance(aura.value + aura.dim);
                const center = shape.center();
                const lcenter = g2l(center);

                const auraCircle = new Circle(center, auraLength);
                if (!auraCircle.visibleInCanvas(ctx.canvas)) continue;

                this.vCtx.globalCompositeOperation = "source-over";
                this.vCtx.fillStyle = "rgba(0, 0, 0, 1)";
                const polygon = computeVisibility(center, TriangulationTarget.VISION, shape.floor.id);
                this.vCtx.beginPath();
                this.vCtx.moveTo(g2lx(polygon[0][0]), g2ly(polygon[0][1]));
                for (const point of polygon) this.vCtx.lineTo(g2lx(point[0]), g2ly(point[1]));
                this.vCtx.closePath();
                this.vCtx.fill();
                if (aura.dim > 0) {
                    // Fill the light aura with a radial dropoff towards the outside.
                    const gradient = this.vCtx.createRadialGradient(
                        lcenter.x,
                        lcenter.y,
                        g2lr(aura.value),
                        lcenter.x,
                        lcenter.y,
                        g2lr(aura.value + aura.dim),
                    );
                    gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
                    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
                    this.vCtx.fillStyle = gradient;
                } else {
                    this.vCtx.fillStyle = "rgba(0, 0, 0, 1)";
                }
                this.vCtx.globalCompositeOperation = "source-in";
                this.vCtx.beginPath();
                this.vCtx.arc(lcenter.x, lcenter.y, g2lr(aura.value + aura.dim), 0, 2 * Math.PI);
                this.vCtx.fill();
                ctx.drawImage(this.virtualCanvas, 0, 0);
                // aura.lastPath = this.updateAuraPath(polygon, auraCircle);
                // shape.invalidate(true);
            }

            if (gameSettingsStore.fowLos && this.floor === activeFloor) {
                ctx.globalCompositeOperation = "source-in";
                ctx.drawImage(layerManager.getLayer(floorStore.currentFloor, "fow-players")!.canvas, 0, 0);
            }

            for (const preShape of this.preFogShapes) {
                if (!preShape.visibleInCanvas(this.canvas)) continue;
                const ogComposite = preShape.globalCompositeOperation;
                if (!gameSettingsStore.fullFow) {
                    if (preShape.globalCompositeOperation === "source-over")
                        preShape.globalCompositeOperation = "destination-out";
                    else if (preShape.globalCompositeOperation === "destination-out")
                        preShape.globalCompositeOperation = "source-over";
                }
                preShape.draw(ctx);
                preShape.globalCompositeOperation = ogComposite;
            }

            if (gameSettingsStore.fullFow && this.floor === activeFloor) {
                ctx.globalCompositeOperation = "source-out";
                ctx.fillStyle = getFogColour();
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            }

            super.draw(false);

            ctx.globalCompositeOperation = originalOperation;
        }
    }
}
