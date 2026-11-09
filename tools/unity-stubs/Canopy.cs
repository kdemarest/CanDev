// Stand-ins for the Canopy classes Claude's Canopy C# leans on (Reliable, chunks, GridGroup, Util),
// so mcs can check it with UnityEngine.cs (Claude, 2026-11-08). Signatures only; nothing works.
// Add what a new script needs; compile the real file instead when its own dependencies are stubbed.
using UnityEngine;
public class EditorAwareMonoBehaviour : MonoBehaviour { }
public class Reliable : EditorAwareMonoBehaviour
{
	public virtual void OnEditorPresave() { }
	public virtual void OnSceneReady() { }
	public virtual void OnEditorRefresh() { }
	public virtual void OnInception() { }
}
public class GridGroup : MonoBehaviour { public float objectSize; public float[] cutoffArray; }
public static class Util { public static Camera GetCam() => null; }
public class Chunk { public enum State { Unloaded = 0, Unloading = 10, Loading = 20, Loaded = 30, Ready = 40, Live = 50 } public int buildIndex; public State state; public System.Collections.Generic.List<GameObject> rootGameObjects; }
public static class Chunks { public static System.Collections.Generic.IEnumerable<Chunk> Playable() => null; }
public static class ForEachComponent
{
	public static System.Collections.Generic.IEnumerable<T> ComponentsAll<T>(this Chunk chunk, bool includeInactive = true) where T : Component => null;
	public static System.Collections.Generic.IEnumerable<T> ComponentsAll<T>(this GameObject go, bool includeInactive = true) where T : Component => null;
	public static Chunk chunk(this GameObject go) => null;
}
// SearchComponents.cs (Canopy's heap-safe searches; never Unity's: Ken, 2026-11-09)
public static class SearchComponents
{
	public static T FindComponentInSelfOrParents<T>(this GameObject obj) where T : Component => null;
}
// Tags.cs
public static class Tags { public static bool IsEditorOnly(this GameObject gameObject) => false; }
