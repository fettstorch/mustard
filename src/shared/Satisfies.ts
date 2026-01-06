/**
 * Utility that emulates Typescript's `satisfies` keyword but for types rather than only for values.
 * This is useful if we want to define a type like a const as to the resulting type being inferred by the definition, yet
 * guarantee that the constructed type abides to an interface.
 *
 * @example
 * ```typescript
 * type Shape = 'circle' | 'square'
 * type ShapeInfos = Satisfies<Record<Shape, object>, {
     circle: { radius: number },
     square: { edgeLength: number }
 * }>
 * ```
 *
 * We could just define ShapeInfos as Record<Shape, object> but then retrieving a specific shape's info would never know
 * exactly what properties it has. Using the Satisfies utility when retrieveing a specific shape's info, the properties
 * of the info-object are known by the typesystem.
 */
export type Satisfies<ToSatisfy, T extends ToSatisfy> = T
