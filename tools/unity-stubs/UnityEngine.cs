// Stubs of the bits of Unity's API that Canopy C# Claude writes uses, so mcs (pkg install mono)
// can check it compiles here, where Unity can't run (Claude, 2026-10-31). Signatures only; nothing
// works. Add what a new script needs. Usage, from /sdcard/dev:
//   mcs -target:library -nowarn:0169,0649 -out:$TMPDIR/check.dll tools/unity-stubs/UnityEngine.cs <files.cs>
namespace UnityEngine
{
    public class Object
    {
        public string name;
        public HideFlags hideFlags;
        public static void Destroy(Object o) { }
        public static void DontDestroyOnLoad(Object o) { }
        public static T[] FindObjectsByType<T>(FindObjectsSortMode mode) where T : Object => null;
        public static implicit operator bool(Object o) => o != null;
        public int GetInstanceID() => 0;
    }
    public enum HideFlags { None, HideAndDontSave }
    public enum FindObjectsSortMode { None, InstanceID }
    public class Component : Object
    {
        public Transform transform => null; public GameObject gameObject => null;
        public T GetComponent<T>() => default(T);
        public T[] GetComponentsInChildren<T>(bool includeInactive = false) => null;
        public T GetComponentInParent<T>(bool includeInactive) => default(T);
        public void GetComponentsInChildren<T>(bool includeInactive, System.Collections.Generic.List<T> results) { }
        public bool CompareTag(string tag) => false;
    }
    public class Behaviour : Component { public bool enabled; public bool isActiveAndEnabled => false; }
    public class MonoBehaviour : Behaviour { }
    public class GameObject : Object
    {
        public GameObject(string name) { }
        public Transform transform => null; public int layer; public bool activeInHierarchy => false;
        public T AddComponent<T>() where T : Component => null;
        public T GetComponent<T>() => default(T);
        public void SetActive(bool on) { }
    }
    public class Transform : Component, System.Collections.IEnumerable
    {
        public Vector3 position, forward, lossyScale; public bool hasChanged; public Matrix4x4 localToWorldMatrix => default(Matrix4x4); public Matrix4x4 worldToLocalMatrix => default(Matrix4x4);
        public Transform Find(string n) => null; public int childCount => 0; public Transform GetChild(int i) => null; public bool IsChildOf(Transform t) => false;
        public System.Collections.IEnumerator GetEnumerator() => null;
    }
    public enum LightType { Spot, Directional, Point, Area }
    public class Light : Behaviour { public LightType type; public float intensity, range, spotAngle, innerSpotAngle; public Color color; public int cullingMask; }
    public class Renderer : Component { public bool enabled; public Bounds bounds => default(Bounds); public Material sharedMaterial;
        public void GetPropertyBlock(MaterialPropertyBlock b) { } public void SetPropertyBlock(MaterialPropertyBlock b) { } }
    public class MeshRenderer : Renderer { }
    public class SkinnedMeshRenderer : Renderer { }
    public class MeshFilter : Component { public Mesh sharedMesh; }
    public class Mesh : Object { public Bounds bounds; }
    public class MaterialPropertyBlock { public void SetVector(int id, Vector4 v) { } }
    public class Collider : Component { public Rigidbody attachedRigidbody => null; }
    public class Rigidbody : Component { }
    public class LODGroup : Component { }
    public enum QueryTriggerInteraction { UseGlobal, Ignore, Collide }
    public static class Physics { public static int OverlapSphereNonAlloc(Vector3 p, float r, Collider[] results, int mask, QueryTriggerInteraction q) => 0; }
    public static class QualitySettings { public static int pixelLightCount; }
    public static class Graphics { public static void DrawMesh(Mesh m, Matrix4x4 x, Material mat, int layer, Camera cam, int submesh = 0, MaterialPropertyBlock b = null) { } }
    public struct Plane { }
    public static class GeometryUtility { public static Plane[] CalculateFrustumPlanes(Camera c) => null; public static bool TestPlanesAABB(Plane[] p, Bounds b) => false; }
    public enum CameraType { Game, SceneView }
    public struct Matrix4x4 { public float m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23; public Vector3 MultiplyPoint3x4(Vector3 p) => p; }
    public struct Bounds
    {
        public Bounds(Vector3 c, Vector3 size) { center = c; extents = size; }
        public Vector3 center, extents; public Vector3 min => center; public Vector3 max => center;
        public Vector3 ClosestPoint(Vector3 p) => p; public void Encapsulate(Bounds b) { }
    }
    public struct Vector3Int
    {
        public int x, y, z; public Vector3Int(int x, int y, int z) { this.x = x; this.y = y; this.z = z; }
        public static bool operator ==(Vector3Int a, Vector3Int b) => true; public static bool operator !=(Vector3Int a, Vector3Int b) => false;
        public override bool Equals(object o) => true; public override int GetHashCode() => 0;
    }
    public struct Color { public float r, g, b, a; public Color linear => this; public static Color operator *(Color c, float f) => c; public static Color white => default(Color); public static Color black => default(Color); public static Color green => default(Color); }
    public enum RuntimeInitializeLoadType { AfterSceneLoad, BeforeSceneLoad }
    public class RuntimeInitializeOnLoadMethodAttribute : System.Attribute { public RuntimeInitializeOnLoadMethodAttribute(RuntimeInitializeLoadType t) { } }
    public class RequireComponent : System.Attribute { public RequireComponent(System.Type t) { } }
    public class SerializeField : System.Attribute { }
    public class Camera : Behaviour { public static Camera main => null; public float fieldOfView; public CameraType cameraType; public static System.Action<Camera> onPreCull; }
    public static class Time { public static float deltaTime => 0; public static float time => 0; }
    public class Shader : Object
    {
        public static int PropertyToID(string name) => 0;
        public static void SetGlobalVector(int id, Vector4 v) { }
        public static void SetGlobalVectorArray(int id, Vector4[] v) { }
        public static void SetGlobalFloat(int id, float v) { }
    }
    public static class Random { public static float Range(float a, float b) => a; public static int Range(int a, int b) => a; }
    public static class Mathf
    {
        public const float PI = 3.14159265f, Deg2Rad = PI / 180, Rad2Deg = 180 / PI;
        public static float Sin(float f) => 0; public static float Cos(float f) => 0; public static float Sqrt(float f) => 0; public static float Acos(float f) => 0; public static float Asin(float f) => 0;
        public static float Max(float a, float b) => a; public static float Min(float a, float b) => a;
        public static int Clamp(int v, int a, int b) => v; public static float Clamp(float v, float a, float b) => v; public static float Clamp01(float v) => v;
        public static float Lerp(float a, float b, float t) => a;
        public static float MoveTowards(float a, float b, float d) => a; public static int FloorToInt(float f) => 0;
        public static float Abs(float f) => f; public static float Tan(float f) => 0; public static int Min(int a, int b) => a; public static int Max(int a, int b) => a;
        public static float Max(float a, float b, float c) => a; public static float Min(float a, float b, float c) => a;
    }
    public struct Vector2
    {
        public float x, y;
        public Vector2(float x, float y) { this.x = x; this.y = y; }
        public static Vector2 right => new Vector2(1, 0);
        public float sqrMagnitude => x * x + y * y;
        public Vector2 normalized => this;
        public static Vector2 operator +(Vector2 a, Vector2 b) => a;
        public static Vector2 operator -(Vector2 a, Vector2 b) => a;
        public static Vector2 operator *(Vector2 a, float f) => a;
        public static Vector2 operator *(float f, Vector2 a) => a;
    }
    public struct Vector3
    {
        public float x, y, z;
        public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
        public static Vector3 operator +(Vector3 a, Vector3 b) => a;
        public static Vector3 operator -(Vector3 a, Vector3 b) => a;
        public static Vector3 operator *(Vector3 a, float f) => a; public static Vector3 operator /(Vector3 a, float f) => a; public static Vector3 zero => default(Vector3);
        public static Vector3 one => default(Vector3); public float sqrMagnitude => 0; public Vector3 normalized => this; public float magnitude => 0;
        public static float Distance(Vector3 a, Vector3 b) => 0; public static float Dot(Vector3 a, Vector3 b) => 0;
    }
    public struct Vector4
    {
        public float x, y, z, w;
        public Vector4(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; }
        public static Vector4 zero => new Vector4(0, 0, 0, 0);
        public static bool operator ==(Vector4 a, Vector4 b) => true; public static bool operator !=(Vector4 a, Vector4 b) => false;
        public override bool Equals(object o) => true; public override int GetHashCode() => 0;
    }
    public class TooltipAttribute : System.Attribute { public TooltipAttribute(string t) { } }
    public class RangeAttribute : System.Attribute { public RangeAttribute(float a, float b) { } }
    public class HeaderAttribute : System.Attribute { public HeaderAttribute(string t) { } }
    public class ContextMenu : System.Attribute { public ContextMenu(string name) { } }
    public class ScriptableObject : Object { }
    public class Material : Object
    {
        public Material(Material source) { }
        public Shader shader;
        public void CopyPropertiesFromMaterial(Material m) { }
    }
    public static class Resources { public static T Load<T>(string path) where T : Object => null; }
    public static class Application { public static bool isPlaying => false; }
    public static class Debug { public static void Log(object m) { } public static void LogWarning(object m) { } public static void LogError(object m) { }
        public static void Assert(bool c, string m = null) { } }
}
namespace UnityEditor
{
    public class MenuItem : System.Attribute { public MenuItem(string path, bool validate = false) { } }
    public class InitializeOnLoadMethodAttribute : System.Attribute { }
    public enum PlayModeStateChange { EnteredEditMode, ExitingEditMode, EnteredPlayMode, ExitingPlayMode }
    public static class EditorApplication { public static event System.Action<PlayModeStateChange> playModeStateChanged; }
}
